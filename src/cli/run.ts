import yargs, { type Argv, type Arguments } from 'yargs'
import { createApp } from '../app/createApp.js'
import type { IO } from './io.js'

/**
 * CLI adapter: parse commands → call application services
 * 
 * Commands:
 * - task create <title> [--file <path> --lines <start-end>]
 * - task list
 * - task cancel <taskId> [--reason <text>]
 * - interact respond <taskId> <choice> [--text <message>]
 * - interact pending [taskId]
 * - agent start | stop | run <taskId>
 * - log replay [streamId]
 * - ui
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
    .command(
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
    .command(
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
    .command(
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
    .command(
      'agent <action> [taskId]',
      'Agent operations',
      (y: Argv) =>
        y
          .positional('action', { type: 'string', choices: ['start', 'stop', 'run'] as const, demandOption: true })
          .positional('taskId', { type: 'string' }),
      async (args: Arguments) => {
        const action = String(args.action)
        if (action === 'start') {
          app.agentRuntime.start()
          io.stdout('agent started\n')
          return
        }
        if (action === 'stop') {
          app.agentRuntime.stop()
          io.stdout('agent stopped\n')
          return
        }
        if (action === 'run') {
          const taskId = String(args.taskId ?? '')
          if (!taskId) throw new Error('agent run requires taskId')
          
          io.stdout(`Running agent on task ${taskId}...\n`)
          
          // Execute task with spinner feedback
          const res = await app.agentRuntime.executeTask(taskId)
          
          // Check final task state
          const task = app.taskService.getTask(taskId)
          if (!task) {
            io.stdout('Task not found after execution\n')
            return
          }

          if (task.status === 'awaiting_user') {
            const pending = app.interactionService.getPendingInteraction(taskId)
            if (pending) {
              io.stdout(`\nAwaiting user input:\n`)
              io.stdout(`  Kind: ${pending.kind}\n`)
              io.stdout(`  Title: ${pending.display.title}\n`)
              if (pending.display.description) {
                io.stdout(`  Description: ${pending.display.description}\n`)
              }
              if (pending.options) {
                const optionLabels = pending.options.map(o => `${o.id}(${o.label})`).join(', ')
                io.stdout(`  Options: ${optionLabels}\n`)
              }
              io.stdout(`\nRespond with: coauthor interact respond ${taskId} <option_id>\n`)
            }
          } else if (task.status === 'done') {
            io.stdout(`\nTask completed successfully.\n`)
            io.stdout(`Events emitted: ${res.events.length}\n`)
          } else if (task.status === 'failed') {
            io.stdout(`\nTask failed.\n`)
          } else {
            io.stdout(`\nTask status: ${task.status}\n`)
          }
        }
      }
    )
    .command('ui', 'Start Ink UI', () => {}, async () => {
      const { runMainTui } = await import('../tui/run.js')
      await runMainTui(app)
    })
    .strict()
    .help()

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

function getStatusIcon(status: string): string {
  switch (status) {
    case 'open': return '○'
    case 'in_progress': return '◐'
    case 'awaiting_user': return '◇'
    case 'done': return '●'
    case 'failed': return '✗'
    case 'canceled': return '⊘'
    default: return '?'
  }
}
