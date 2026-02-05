import { type Argv, type Arguments } from 'yargs'
import { type App } from '../../app/createApp.js'
import { type IO } from '../io.js'

export function registerAuditCommand(parser: Argv, app: App, io: IO): Argv {
  return parser.command(
    'audit <action> [taskId]',
    'Audit log operations',
    (y: Argv) =>
      y
        .positional('action', { type: 'string', choices: ['list'] as const, demandOption: true })
        .positional('taskId', { type: 'string' })
        .option('limit', { type: 'number', default: 20 }),
    async (args: Arguments) => {
      const action = String(args.action)
      if (action === 'list') {
        const taskId = args.taskId ? String(args.taskId) : undefined
        const limit = Number(args.limit)
        const entries = app.auditService.getRecentEntries(taskId, limit)
        
        if (entries.length === 0) {
          io.stdout('No audit entries found\n')
          return
        }

        io.stdout(
          'Time'.padEnd(24) + 
          'Tool'.padEnd(20) + 
          'Type'.padEnd(20) + 
          'Status'.padEnd(10) + 
          'Duration'.padEnd(10) + 
          '\n'
        )
        io.stdout('-'.repeat(90) + '\n')
        
        for (const entry of entries) {
          const time = entry.createdAt.slice(0, 23)
          let toolName = ''
          let status = ''
          let duration = ''
          
          if (entry.type === 'ToolCallRequested') {
            toolName = entry.payload.toolName
            status = 'REQ'
          } else {
            toolName = entry.payload.toolName
            status = entry.payload.isError ? 'ERR' : 'OK'
            duration = `${entry.payload.durationMs}ms`
          }

          io.stdout(
            time.padEnd(24) + 
            toolName.slice(0, 19).padEnd(20) + 
            entry.type.slice(0, 19).padEnd(20) + 
            status.padEnd(10) + 
            duration.padEnd(10) + 
            '\n'
          )
        }
      }
    }
  )
}
