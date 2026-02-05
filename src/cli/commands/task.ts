import { type Argv, type Arguments } from 'yargs'
import { type App } from '../../app/createApp.js'
import { type IO } from '../io.js'
import { getStatusIcon } from './utils.js'

export function registerTaskCommand(parser: Argv, app: App, io: IO): Argv {
  return parser.command(
    'task <action> [args..]',
    'Task operations',
    (y: Argv) =>
      y
        .positional('action', { type: 'string', choices: ['create', 'list', 'cancel'] as const, demandOption: true })
        .positional('args', { type: 'string', array: true })
        .option('file', { type: 'string' })
        .option('lines', { type: 'string' })
        .option('reason', { type: 'string' }),
    async (args: Arguments) => {
      const action = String(args.action)
      if (action === 'create') {
        const title = ((args.args as unknown as string[] | undefined) ?? []).join(' ').trim()
        const file = args.file ? String(args.file) : ''
        const lines = args.lines ? String(args.lines) : ''
        const hasRef = Boolean(file || lines)
        if (hasRef && (!file || !lines)) {
          throw new Error('task create with --file requires --lines, e.g.: --lines 10-20')
        }

        const artifactRefs =
          file && lines
            ? (() => {
                const m = /^(\d+)-(\d+)$/.exec(lines)
                if (!m) throw new Error('lines format error, should be <start>-<end>, e.g. 10-20')
                const lineStart = Number(m[1])
                const lineEnd = Number(m[2])
                if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart <= 0 || lineEnd <= 0 || lineEnd < lineStart) {
                  throw new Error('lines must be positive integers with end >= start')
                }
                return [{ kind: 'file_range' as const, path: file, lineStart, lineEnd }]
              })()
            : undefined

        const { taskId } = app.taskService.createTask({ title, artifactRefs, agentId: app.agent.id })
        io.stdout(`${taskId}\n`)
        return
      }

      if (action === 'list') {
        const state = app.taskService.listTasks()
        for (const t of state.tasks) {
          const statusIcon = getStatusIcon(t.status)
          io.stdout(`  ${statusIcon} ${t.taskId} [${t.status}] ${t.title}\n`)
        }
        return
      }

      if (action === 'cancel') {
        const positionalArgs = (args.args as unknown as string[] | undefined) ?? []
        const taskId = (positionalArgs[0] ?? '').trim()
        if (!taskId) throw new Error('task cancel requires taskId')
        const reason = args.reason ? String(args.reason) : undefined
        app.taskService.cancelTask(taskId, reason)
        io.stdout('canceled\n')
        return
      }
    }
  )
}
