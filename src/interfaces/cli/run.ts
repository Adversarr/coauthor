import yargs from 'yargs'
import { nanoid } from 'nanoid'
import { createApp, type App } from '../app/createApp.js'
import { createRemoteApp } from '../app/createRemoteApp.js'
import type { IO } from './io.js'
import { discoverMaster } from '../../infrastructure/master/discovery.js'
import { lockFilePath, writeLockFile, readLockFile, removeLockFile, isProcessAlive } from '../../infrastructure/master/lockFile.js'
import { SeedServer } from '../../infrastructure/servers/server.js'

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
    cleanup = () => { removeLockFile(lockPath); server.stop().catch(() => {}) }
    process.on('SIGINT', () => { cleanup?.(); process.exit(0) })
    process.on('SIGTERM', () => { cleanup?.(); process.exit(0) })
    return { started: true, url: `http://${addr.host}:${addr.port}`, token: authToken }
  }

  const parser = yargs(argv)
    .scriptName('seed')
    .option('workspace', { alias: 'w', type: 'string', default: workspace })
    .strict()
    .help()

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

  try {
    await parser.parseAsync()
    cleanup?.()
    return 0
  } catch (err) {
    cleanup?.()
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
  return cmd === 'task' || cmd === 'agent' || cmd === 'interact' || cmd === 'log' || cmd === 'audit' || cmd === 'llm'
}
