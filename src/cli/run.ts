import yargs from 'yargs'
import { createApp } from '../app/createApp.js'
import type { IO } from './io.js'
import { registerTaskCommand } from './commands/task.js'
import { registerInteractCommand } from './commands/interact.js'
import { registerAgentCommand } from './commands/agent.js'
import { registerAuditCommand } from './commands/audit.js'
import { registerLogCommand } from './commands/log.js'
import { registerLlmCommand } from './commands/llm.js'
import { registerUiCommand } from './commands/ui.js'

/**
 * CLI adapter: parse commands → call application services
 * 
 * Commands are split into independent modules in ./commands/
 */
export async function runCli(opts: {
  argv: string[]
  baseDir: string
  io: IO
}): Promise<number> {
  const { argv, baseDir, io } = opts
  const app = createApp({ baseDir })

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
  registerUiCommand(parser, app)

  // Default behavior: run TUI if no arguments
  if (argv.length === 0) {
    const { runMainTui } = await import('../tui/run.js')
    await runMainTui(app)
    return 0
  }

  try {
    await parser.parseAsync()
    return 0
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}
