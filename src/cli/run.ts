import yargs from 'yargs'
import { nanoid } from 'nanoid'
import { createApp } from '../app/createApp.js'
import { createRemoteApp } from '../app/createRemoteApp.js'
import type { IO } from './io.js'
import { registerTaskCommand } from './commands/task.js'
import { registerInteractCommand } from './commands/interact.js'
import { registerAgentCommand } from './commands/agent.js'
import { registerAuditCommand } from './commands/audit.js'
import { registerLogCommand } from './commands/log.js'
import { registerLlmCommand } from './commands/llm.js'
import { registerUiCommand } from './commands/ui.js'
import { registerServeCommand } from './commands/serve.js'
import { discoverMaster } from '../infra/master/discovery.js'
import { lockFilePath, writeLockFile, removeLockFile } from '../infra/master/lockFile.js'
import { CoAuthorServer } from '../infra/server.js'

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
  baseDir: string
  io: IO
}): Promise<number> {
  const { argv, baseDir, io } = opts

  // Discover if a master process is already running
  const discovery = await discoverMaster(baseDir)
  let app
  let cleanup: (() => void) | undefined

  if (discovery.mode === 'client') {
    // Connect to existing master via HTTP/WS
    app = await createRemoteApp({ baseDir, port: discovery.port, token: discovery.token })
  } else {
    // No master — create a local app
    app = await createApp({ baseDir })
  }

  // Helper: start background HTTP/WS server (for TUI & serve command)
  const startServer = async (): Promise<void> => {
    if (discovery.mode === 'client') return // already connected to master
    const authToken = nanoid(32)
    const server = new CoAuthorServer(app, { authToken })
    await server.start()
    const addr = server.address!
    const lockPath = lockFilePath(baseDir)
    writeLockFile(lockPath, { pid: process.pid, port: addr.port, token: authToken, startedAt: new Date().toISOString() })
    io.stdout(`Web UI: http://${addr.host}:${addr.port}\n Auth Token: ${authToken}\n`)
    cleanup = () => { removeLockFile(lockPath); server.stop().catch(() => {}) }
    process.on('SIGINT', () => { cleanup?.(); process.exit(0) })
    process.on('SIGTERM', () => { cleanup?.(); process.exit(0) })
  }

  const parser = yargs(argv)
    .scriptName('coauthor')
    .strict()
    .help()

  // Register commands
  registerTaskCommand(parser, app, io)
  registerInteractCommand(parser, app, io)
  registerAgentCommand(parser, app, io)
  registerAuditCommand(parser, app, io)
  registerLogCommand(parser, app, io)
  registerLlmCommand(parser, app, io)
  registerUiCommand(parser, app, baseDir)
  registerServeCommand(parser, app, io, startServer)

  // Default behavior: run TUI if no arguments
  if (argv.length === 0) {
    await startServer()
    const { runMainTui } = await import('../tui/run.js')
    await runMainTui(app)
    cleanup?.()
    return 0
  }

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
