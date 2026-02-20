import yargs from 'yargs'
import { nanoid } from 'nanoid'
import { createApp, type App } from '../app/createApp.js'
import { createRemoteApp } from '../app/createRemoteApp.js'
import type { IO } from './io.js'
import { discoverMaster } from '../../infrastructure/master/discovery.js'
import { lockFilePath, writeLockFile, readLockFile, removeLockFile, isProcessAlive } from '../../infrastructure/master/lockFile.js'
import { SeedServer } from '../../infrastructure/servers/server.js'
import { loadAppConfig } from '../../config/appConfig.js'
import { createLLMClient } from '../../infrastructure/llm/createLLMClient.js'
import type { LLMClient, LLMMessage } from '../../core/ports/llmClient.js'
import type { ToolDefinition } from '../../core/ports/tool.js'
import { executeWebSearchSubagent, hasProfile } from '../../infrastructure/tools/webSubagentClient.js'

const CONNECT_TEST_TOOL: ToolDefinition = {
  name: 'diagnostic_echo',
  description: 'Echo diagnostic payload back to the caller.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Diagnostic text',
      },
    },
    required: ['text'],
  },
}

/**
 * CLI adapter: parse commands → call application services
 * 
 * Master/client discovery:
 * - Checks for existing master process via lock file.
 * - If no master: creates local App + starts HTTP/WS server → becomes master.
 * - If master exists: creates remote App (delegates to master via HTTP/WS).
 * 
 * Commands are split into independent modules in ./commands/
 */
export async function runCli(opts: {
  argv: string[]
  defaultWorkspace: string
  io: IO
}): Promise<number> {
  const { argv, defaultWorkspace, io } = opts

  const workspace = resolveWorkspaceFromArgv(argv, defaultWorkspace)

  if (isRemovedCommand(argv[0] ?? '')) {
    io.stderr(`This command was removed from the CLI. Use the TUI or Web UI instead.\n`)
    return 1
  }

  let discovery: Awaited<ReturnType<typeof discoverMaster>> | undefined
  let app: App | undefined
  let cleanup: (() => void) | undefined

  const getDiscovery = async (): Promise<Awaited<ReturnType<typeof discoverMaster>>> => {
    if (discovery) return discovery
    discovery = await discoverMaster(workspace)
    return discovery
  }

  const getApp = async (): Promise<App> => {
    if (app) return app
    const d = await getDiscovery()
    if (d.mode === 'client') {
      app = await createRemoteApp({ baseDir: workspace, port: d.port, token: d.token })
      return app
    }
    app = await createApp({ baseDir: workspace })
    return app
  }

  const startServer = async (opts?: {
    host?: string
    port?: number
    printToken?: boolean
  }): Promise<{ started: boolean; url: string; token: string }> => {
    const host = opts?.host ?? '127.0.0.1'
    const port = opts?.port  // undefined → SeedServer defaults to DEFAULT_PORT (3120)
    const printToken = opts?.printToken ?? false

    const d = await getDiscovery()
    if (d.mode === 'client') {
      return { started: false, url: `http://${host}:${d.port}`, token: d.token }
    }

    const authToken = nanoid(32)
    const localApp = await getApp()
    const server = new SeedServer(localApp, { authToken, host, port })
    await server.start()
    const addr = server.address!
    const lockPath = lockFilePath(workspace)
    writeLockFile(lockPath, { pid: process.pid, port: addr.port, token: authToken, startedAt: new Date().toISOString() })
    if (printToken) {
      io.stdout(`Web UI: http://${addr.host}:${addr.port}\nAuth Token: ${authToken}\n`)
    } else {
      io.stdout(`Web UI: http://${addr.host}:${addr.port}\n`)
    }
    cleanup = () => {
      removeLockFile(lockPath)
      server.stop().catch(() => {})
      localApp.dispose().catch(() => {})
    }
    process.on('SIGINT', () => { cleanup?.(); process.exit(0) })
    process.on('SIGTERM', () => { cleanup?.(); process.exit(0) })
    return { started: true, url: `http://${addr.host}:${addr.port}`, token: authToken }
  }

  const parser = yargs(argv)
    .scriptName('seed')
    .option('workspace', { alias: 'w', type: 'string', default: workspace })
    .strict()
    .help()
  let commandExitCode = 0

  const runTui = async (): Promise<void> => {
    const app = await getApp()
    const info = await startServer({ printToken: false })
    if (!info.started) io.stdout(`Web UI: ${info.url}\n`)
    const { runMainTui } = await import('../tui/run.js')
    await runMainTui(app)
    cleanup?.()
  }

  parser.command(
    '$0',
    'Start interactive TUI (starts/attaches to the local server)',
    (y) => y,
    runTui,
  )

  parser.command(
    'ui',
    'Start interactive TUI (alias of default)',
    (y) => y,
    runTui,
  )

  parser.command(
    'serve',
    'Start Web UI server (headless, no TUI)',
    (y) => y.option('host', { type: 'string', default: '127.0.0.1' }).option('port', { type: 'number' }),
    async (args) => {
      const host = typeof args.host === 'string' ? args.host : '127.0.0.1'
      const port = typeof args.port === 'number' ? args.port : undefined
      const info = await startServer({ host, port, printToken: true })
      if (!info.started) {
        io.stdout(`Already running.\nWeb UI: ${info.url}\nAuth Token: ${info.token}\n`)
        return
      }

      const app = await getApp()
      app.runtimeManager.start()
      io.stdout(`Press Ctrl+C to stop.\n`)
      await new Promise(() => {})
    },
  )

  parser.command(
    'status',
    'Show server status for the selected workspace',
    (y) => y,
    async () => {
      const lockPath = lockFilePath(workspace)
      const d = await discoverMaster(workspace)
      io.stdout(`Workspace: ${workspace}\n`)
      io.stdout(`Lock File: ${lockPath}\n`)
      if (d.mode === 'client') {
        io.stdout(`Server: running\n`)
        io.stdout(`Web UI: http://127.0.0.1:${d.port}\n`)
        return
      }
      io.stdout(`Server: not running\n`)
    },
  )

  parser.command(
    'stop',
    'Stop server for the selected workspace (best-effort)',
    (y) => y,
    async () => {
      const lockPath = lockFilePath(workspace)
      const data = readLockFile(lockPath)
      if (!data) {
        io.stdout(`No server lock found.\n`)
        return
      }
      if (!isProcessAlive(data.pid)) {
        removeLockFile(lockPath)
        io.stdout(`Stale lock removed (pid not running).\n`)
        return
      }
      try {
        process.kill(data.pid, 'SIGTERM')
      } catch (err) {
        io.stderr(`${err instanceof Error ? err.message : String(err)}\n`)
        return
      }
      io.stdout(`Sent SIGTERM to pid ${data.pid}.\n`)
    },
  )

  parser.command(
    'llm test <kind>',
    'Run LLM diagnostics (connect | websearch)',
    (y) =>
      y
        .positional('kind', {
          type: 'string',
          choices: ['connect', 'websearch'],
        })
        .option('query', { type: 'string', default: 'latest AI model updates' }),
    async (args) => {
      if (args.kind === 'connect') {
        commandExitCode = await runLLMConnectivityDiagnostics({
          workspace,
          io,
        })
        return
      }

      commandExitCode = await runLLMWebSearchDiagnostics({
        workspace,
        io,
        query: typeof args.query === 'string' ? args.query : 'latest AI model updates',
      })
    },
  )

  try {
    await parser.parseAsync()
    cleanup?.()
    if (app) {
      await app.dispose()
    }
    return commandExitCode
  } catch (err) {
    cleanup?.()
    if (app) {
      await app.dispose()
    }
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

function resolveWorkspaceFromArgv(argv: string[], defaultWorkspace: string): string {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? ''
    if (token === '--workspace' || token === '-w') {
      const value = argv[i + 1]
      if (typeof value === 'string' && value.trim()) return value.trim()
      continue
    }
    if (token.startsWith('--workspace=')) {
      const value = token.slice('--workspace='.length).trim()
      if (value) return value
      continue
    }
    if (token.startsWith('-w=')) {
      const value = token.slice('-w='.length).trim()
      if (value) return value
      continue
    }
  }
  return defaultWorkspace
}

function isRemovedCommand(cmd: string): boolean {
  return cmd === 'task' || cmd === 'agent' || cmd === 'interact' || cmd === 'log' || cmd === 'audit'
}

function previewText(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

async function runLLMConnectivityDiagnostics(input: {
  workspace: string
  io: IO
}): Promise<number> {
  const config = loadAppConfig(process.env, { workspaceDir: input.workspace })
  const llm = createLLMClient(config)

  input.io.stdout(`Provider: ${llm.provider}\n`)

  const profiles: string[] = ['fast', 'reasoning']
  for (const profile of profiles) {
    try {
      const result = await probeToolCapableReply({
        llm,
        profile,
      })
      const toolState = result.usedTool ? 'tool-call path verified' : 'no tool-call emitted'
      input.io.stdout(`[ok] ${profile}: ${toolState}; response=\"${previewText(result.content, 120)}\"\n`)
    } catch (error) {
      input.io.stderr(`[fail] ${profile}: ${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }
  }

  input.io.stdout('LLM connectivity diagnostics passed.\n')
  return 0
}

async function probeToolCapableReply(input: {
  llm: LLMClient
  profile: string
}): Promise<{ usedTool: boolean; content: string }> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: 'You are a diagnostics assistant.',
    },
    {
      role: 'user',
      content:
        'First call diagnostic_echo with {"text":"seed-connectivity"} and then provide a short final confirmation sentence.',
    },
  ]

  let usedTool = false
  const maxTurns = 4

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await input.llm.complete({
      profile: input.profile,
      messages,
      tools: [CONNECT_TEST_TOOL],
      maxTokens: 512,
    })

    if (response.toolCalls && response.toolCalls.length > 0) {
      usedTool = true
      messages.push({
        role: 'assistant',
        content: response.content,
        reasoning: response.reasoning,
        toolCalls: response.toolCalls,
      })
      for (const call of response.toolCalls) {
        const toolPayload = {
          ok: call.toolName === CONNECT_TEST_TOOL.name,
          toolName: call.toolName,
          input: call.arguments,
        }
        messages.push({
          role: 'tool',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          content: JSON.stringify(toolPayload),
        })
      }
      continue
    }

    const finalText = response.content?.trim() ?? ''
    if (!finalText) {
      throw new Error('empty model response')
    }

    if (input.llm.provider !== 'fake' && !usedTool) {
      throw new Error('model returned text but did not exercise tool-call path')
    }

    return { usedTool, content: finalText }
  }

  throw new Error(`model did not produce a final response after ${maxTurns} turns`)
}

async function runLLMWebSearchDiagnostics(input: {
  workspace: string
  io: IO
  query: string
}): Promise<number> {
  const config = loadAppConfig(process.env, { workspaceDir: input.workspace })
  if (config.llm.provider === 'openai' || config.llm.provider === 'fake') {
    input.io.stdout(`web_search is not supported for provider \"${config.llm.provider}\"\n`)
    return 0
  }

  const llm = createLLMClient(config)
  const profile = 'research_web'

  if (!hasProfile(llm, profile)) {
    input.io.stderr(
      `Missing profile \"${profile}\" in SEED_LLM_PROFILES_JSON; web search diagnostics cannot run.\n`,
    )
    return 1
  }

  const result = await executeWebSearchSubagent({
    llm,
    profile,
    prompt: input.query,
  })

  if (result.status === 'unsupported') {
    input.io.stdout(`${result.message}\n`)
    return 0
  }

  if (result.status === 'error') {
    input.io.stderr(
      `${result.message}${typeof result.statusCode === 'number' ? ` (status=${result.statusCode})` : ''}\n`,
    )
    return 1
  }

  input.io.stdout(`Provider: ${result.provider}\n`)
  input.io.stdout(`Query: ${input.query}\n`)
  input.io.stdout(`Result: ${previewText(result.content, 400)}\n`)
  return 0
}
