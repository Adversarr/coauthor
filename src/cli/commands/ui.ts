import { type Argv } from 'yargs'
import { type App } from '../../app/createApp.js'

export function registerUiCommand(parser: Argv, app: App): Argv {
  return parser.command('ui', 'Start Ink UI', () => {}, async () => {
    const { runMainTui } = await import('../../tui/run.js')
    await runMainTui(app)
  })
}
