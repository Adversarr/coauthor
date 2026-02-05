import { type Argv, type Arguments } from 'yargs'
import { type App } from '../../app/createApp.js'
import { type IO } from '../io.js'

export function registerInteractCommand(parser: Argv, app: App, io: IO): Argv {
  return parser.command(
    'interact <action> [taskId] [choice]',
    'User interaction operations',
    (y: Argv) =>
      y
        .positional('action', { type: 'string', choices: ['respond', 'pending'] as const, demandOption: true })
        .positional('taskId', { type: 'string' })
        .positional('choice', { type: 'string' })
        .option('text', { type: 'string' }),
    async (args: Arguments) => {
      const action = String(args.action)

      if (action === 'respond') {
        const taskId = String(args.taskId ?? '')
        const choice = String(args.choice ?? '')
        if (!taskId) throw new Error('interact respond requires taskId')
        if (!choice) throw new Error('interact respond requires choice (option id)')
        
        // Get the pending interaction to get the interactionId
        const pending = app.interactionService.getPendingInteraction(taskId)
        if (!pending) {
          throw new Error(`No pending interaction for task ${taskId}`)
        }
        
        const text = args.text ? String(args.text) : undefined
        app.interactionService.respondToInteraction(taskId, pending.interactionId, {
          selectedOptionId: choice,
          inputValue: text
        })
        io.stdout('responded\n')
        return
      }

      if (action === 'pending') {
        const taskId = args.taskId ? String(args.taskId) : undefined
        
        if (taskId) {
          // Get pending interaction for specific task
          const pending = app.interactionService.getPendingInteraction(taskId)
          if (pending) {
            io.stdout(`Pending interaction for task ${taskId}:\n`)
            io.stdout(`  ID: ${pending.interactionId}\n`)
            io.stdout(`  Kind: ${pending.kind}\n`)
            io.stdout(`  Purpose: ${pending.purpose}\n`)
            io.stdout(`  Title: ${pending.display.title}\n`)
            if (pending.display.description) {
              io.stdout(`  Description: ${pending.display.description}\n`)
            }
            if (pending.options) {
              const optionLabels = pending.options.map(o => o.label).join(', ')
              io.stdout(`  Options: ${optionLabels}\n`)
            }
          } else {
            io.stdout(`No pending interaction for task ${taskId}\n`)
          }
        } else {
          // List all pending interactions
          const tasks = app.taskService.listTasks().tasks
          const awaitingTasks = tasks.filter(t => t.status === 'awaiting_user')
          if (awaitingTasks.length === 0) {
            io.stdout('No pending interactions\n')
          } else {
            io.stdout('Pending interactions:\n')
            for (const t of awaitingTasks) {
              const pending = app.interactionService.getPendingInteraction(t.taskId)
              if (pending) {
                io.stdout(`  ${t.taskId}: [${pending.kind}] ${pending.display.title}\n`)
              }
            }
          }
        }
        return
      }
    }
  )
}
