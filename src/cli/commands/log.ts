import { type Argv, type Arguments } from 'yargs'
import { type App } from '../../app/createApp.js'
import { type IO } from '../io.js'

export function registerLogCommand(parser: Argv, app: App, io: IO): Argv {
  return parser.command(
    'log <action> [streamId]',
    'Log and replay operations',
    (y: Argv) =>
      y
        .positional('action', { type: 'string', choices: ['replay'] as const, demandOption: true })
        .positional('streamId', { type: 'string' }),
    async (args: Arguments) => {
      const streamId = args.streamId ? String(args.streamId) : undefined
      const events = app.eventService.replayEvents(streamId)
      for (const e of events) {
        io.stdout(`${e.id} ${e.streamId}#${e.seq} ${e.type} ${JSON.stringify(e.payload)}\n`)
      }
    }
  )
}
