import yargs, { type Argv, type Arguments } from 'yargs'
import { createApp } from '../app/createApp.js'
import type { IO } from './io.js'

// CLI adapter: parse commands → call application services
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
      '任务相关操作',
      (y: Argv) =>
        y
          .positional('action', { type: 'string', choices: ['create', 'list'] as const, demandOption: true })
          .positional('args', { type: 'string', array: true }),
      async (args: Arguments) => {
        const action = String(args.action)
        if (action === 'create') {
          const title = ((args.args as unknown as string[] | undefined) ?? []).join(' ').trim()
          const { taskId } = app.taskService.createTask(title)
          io.stdout(`${taskId}\n`)
          return
        }

        if (action === 'list') {
          const state = app.taskService.listTasks()
          for (const t of state.tasks) {
            const current = t.taskId === state.currentTaskId ? '*' : ' '
            io.stdout(`${current} ${t.taskId} ${t.title}\n`)
          }
          return
        }
      }
    )
    .command(
      'thread <action> <taskId>',
      'thread 相关操作',
      (y: Argv) =>
        y
          .positional('action', { type: 'string', choices: ['open'] as const, demandOption: true })
          .positional('taskId', { type: 'string', demandOption: true }),
      async (args: Arguments) => {
        const taskId = String(args.taskId)
        app.taskService.openThread(taskId)
        io.stdout(`opened ${taskId}\n`)
      }
    )
    .command(
      'patch <action> <taskId> [arg1] [arg2]',
      'patch propose/accept',
      (y: Argv) =>
        y
          .positional('action', { type: 'string', choices: ['propose', 'accept'] as const, demandOption: true })
          .positional('taskId', { type: 'string', demandOption: true })
          .positional('arg1', { type: 'string' })
          .positional('arg2', { type: 'string' }),
      async (args: Arguments) => {
        const action = String(args.action)
        const taskId = String(args.taskId)

        if (action === 'propose') {
          const targetPath = String(args.arg1 ?? '')
          if (!targetPath) throw new Error('patch propose 需要提供 targetPath')
          const patchText = (await io.readStdin()).trimEnd()
          if (!patchText) throw new Error('未从 stdin 读取到 patch 文本')
          const { proposalId } = app.patchService.proposePatch(taskId, targetPath, patchText)
          io.stdout(`${proposalId}\n`)
          return
        }

        if (action === 'accept') {
          const proposalIdOrLatest = String(args.arg1 ?? 'latest')
          const res = await app.patchService.acceptAndApplyPatch(taskId, proposalIdOrLatest)
          io.stdout(`applied ${res.proposalId} -> ${res.targetPath}\n`)
          return
        }
      }
    )
    .command(
      'log <action> [streamId]',
      '日志与回放',
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
      'Agent 相关操作',
      (y: Argv) =>
        y
          .positional('action', { type: 'string', choices: ['start', 'stop', 'handle'] as const, demandOption: true })
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
        if (action === 'handle') {
          const taskId = String(args.taskId ?? '')
          if (!taskId) throw new Error('agent handle 需要提供 taskId')
          const res = await app.agentRuntime.handleTask(taskId)
          io.stdout(`${res.planId}\n`)
          io.stdout(`${JSON.stringify(res.plan, null, 2)}\n`)
        }
      }
    )
    .command('ui', '启动 Ink UI', () => {}, async () => {
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
