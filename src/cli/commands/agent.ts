import { type Argv, type Arguments } from 'yargs'
import { type App } from '../../app/createApp.js'
import { type IO } from '../io.js'

export function registerAgentCommand(parser: Argv, app: App, io: IO): Argv {
  return parser.command(
    'agent <action> [args..]',
    'Agent operations',
    (y: Argv) =>
      y
        .positional('action', { type: 'string', choices: ['start', 'stop', 'run', 'test'] as const, demandOption: true })
        .positional('args', { type: 'string', array: true }),
    async (args: Arguments) => {
      const action = String(args.action)
      const positionalArgs = (args.args as unknown as string[] | undefined) ?? []

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
      
      if (action === 'test') {
        const prompt = positionalArgs.join(' ').trim()
        if (!prompt) throw new Error('agent test requires a prompt, e.g. "coauthor agent test say hello"')
        
        io.stdout(`Creating task for test: "${prompt}"...\n`)
        
        const { taskId } = app.taskService.createTask({
          title: 'Test Agent Task',
          intent: prompt,
          agentId: app.agent.id
        })
        
        io.stdout(`Task created: ${taskId}\n`)
        io.stdout(`Running agent...\n`)
        
        // Fall through to execution logic (shared with 'run')
        // We can just call executeTask here
        await executeTask(app, io, taskId)
        return
      }

      if (action === 'run') {
        const taskId = positionalArgs[0]
        if (!taskId) throw new Error('agent run requires taskId')
        
        io.stdout(`Running agent on task ${taskId}...\n`)
        await executeTask(app, io, taskId)
      }
    }
  )
}

async function executeTask(app: App, io: IO, taskId: string) {
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
