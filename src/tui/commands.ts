import { readFile, access } from 'node:fs/promises'
import type { LLMMessage } from '../domain/ports/llmClient.js'
import type { App } from '../app/createApp.js'
import { formatToolOutput } from './utils.js'

export type ReplayEntry = {
  variant: 'plain' | 'markdown'
  content: string
  prefix?: string
  color?: string
  dim?: boolean
  bold?: boolean
}

export type CommandContext = {
  app: App
  refresh: () => Promise<void>
  setStatus: (status: string) => void
  setReplayOutput: (entries: ReplayEntry[]) => void
  focusedTaskId: string | null
  setFocusedTaskId: (id: string | null) => void
  setShowTasks: (show: boolean) => void
  setShowVerbose: (show: boolean | ((previous: boolean) => boolean)) => void
}

export async function handleCommand(line: string, ctx: CommandContext) {
  const trimmed = line.trim()
  if (!trimmed) return

  if (!trimmed.startsWith('/')) {
    ctx.setStatus('Command must start with /, type /help for available commands')
    return
  }

  const parts = trimmed.slice(1).split(/\s+/)
  const command = parts[0]
  const args = parts.slice(1)
  const argString = args.join(' ')

  try {
    switch (command) {
      case 'new':
      case 'n': {
        const title = argString
        if (!title) {
          ctx.setStatus('Usage: /new <title>')
          return
        }
        const task = await ctx.app.taskService.createTask({ title, agentId: ctx.app.runtimeManager.defaultAgentId })
        ctx.setFocusedTaskId(task.taskId)
        await ctx.refresh()
        ctx.setStatus(`Task created and focused: ${task.taskId}`)
        return
      }

      case 'focus':
      case 'f': {
        const targetId = args[0]?.trim()
        if (!targetId) {
          await ctx.refresh()
          ctx.setShowTasks(true)
          ctx.setStatus('Open task list to select focus')
          return
        }
        const exists = await ctx.app.taskService.getTask(targetId)
        if (!exists) {
          ctx.setStatus(`Task not found: ${targetId}`)
          return
        }
        ctx.setFocusedTaskId(targetId)
        await ctx.refresh()
        ctx.setStatus(`Focused task: ${targetId}`)
        return
      }

      case 'next':
      case 'prev': {
        const state = await ctx.app.taskService.listTasks()
        const list = state.tasks
        if (list.length === 0) {
          ctx.setStatus('No tasks available')
          return
        }
        const currentIndex = ctx.focusedTaskId
          ? Math.max(0, list.findIndex(t => t.taskId === ctx.focusedTaskId))
          : -1
        const nextIndex =
          command === 'next'
            ? (currentIndex + 1) % list.length
            : (currentIndex <= 0 ? list.length - 1 : currentIndex - 1)
        const nextTask = list[nextIndex]
        ctx.setFocusedTaskId(nextTask.taskId)
        await ctx.refresh()
        ctx.setStatus(`Focused task: ${nextTask.taskId}`)
        return
      }

      case 'tasks':
      case 'ls':
      case 'list': {
        await ctx.refresh()
        ctx.setShowTasks(true)
        ctx.setStatus('Task list updated')
        return
      }

      case 'cancel':
      case 'c': {
        const targetId = args[0] || ctx.focusedTaskId
        if (!targetId) {
          ctx.setStatus('No focused task. Usage: /cancel [taskId]')
          return
        }
        
        // Simple heuristic: if args[0] is provided, assume it is taskId.
        // Users should focus task first ideally.
        const taskId = args[0] || ctx.focusedTaskId!
        const reason = args.length > 1 ? args.slice(1).join(' ') : undefined

        await ctx.app.taskService.cancelTask(taskId, reason)
        await ctx.refresh()
        ctx.setStatus(`Task cancelled: ${taskId}`)
        return
      }

      case 'pause':
      case 'p': {
        const taskId = ctx.focusedTaskId
        if (!taskId) {
          ctx.setStatus('No focused task. Select a task first.')
          return
        }
        const reason = argString || undefined
        await ctx.app.taskService.pauseTask(taskId, reason)
        await ctx.refresh()
        ctx.setStatus(`Task paused: ${taskId}`)
        return
      }

      case 'resume':
      case 'start': {
        const taskId = ctx.focusedTaskId
        if (!taskId) {
          ctx.setStatus('No focused task. Select a task first.')
          return
        }
        const reason = argString || undefined
        await ctx.app.taskService.resumeTask(taskId, reason)
        await ctx.refresh()
        ctx.setStatus(`Task resumed: ${taskId}`)
        return
      }

      case 'continue':
      case 'refine': {
        const taskId = ctx.focusedTaskId
        if (!taskId) {
          ctx.setStatus('No focused task. Select a task first.')
          return
        }
        const instruction = argString
        if (!instruction) {
          ctx.setStatus(`Usage: /${command} <instruction>`)
          return
        }
        await ctx.app.taskService.addInstruction(taskId, instruction)
        await ctx.refresh()
        ctx.setStatus(`Instruction added to task: ${taskId}`)
        return
      }

      case 'replay':
      case 'r':
      case 'log': {
        const targetId = await resolveTargetTaskId(args[0], ctx)
        if (!targetId) {
          ctx.setStatus('No task found to replay')
          return
        }
        const messages = await ctx.app.conversationStore.getMessages(targetId)
        const entries = messages.flatMap((message) => buildReplayEntries(message))
        ctx.setReplayOutput(
          entries.length > 0
            ? entries
            : [{ variant: 'plain', content: '(no conversation history)', color: 'cyan', dim: true }]
        )
        ctx.setStatus(`Replayed ${messages.length} messages for ${targetId}`)
        return
      }

      case 'replay-raw': {
        const targetId = await resolveTargetTaskId(args[0], ctx)
        const rawLines = await readConversationRawLines(ctx.app.conversationsPath)
        const filteredLines = targetId
          ? rawLines.filter((line) => line.includes(`"taskId":"${targetId}"`))
          : rawLines

        const entries: ReplayEntry[] =
          filteredLines.length > 0
            ? filteredLines.map((line) => ({
                variant: 'plain',
                content: line,
                color: 'cyan',
                dim: true
              }))
            : [{ variant: 'plain', content: '(no raw conversation logs)', color: 'cyan', dim: true }]

        ctx.setReplayOutput(entries)
        ctx.setStatus(
          targetId
            ? `Replayed raw conversation logs for ${targetId}`
            : 'Replayed raw conversation logs'
        )
        return
      }

      case 'help':
      case 'h':
      case '?': {
        ctx.setStatus(
          'Commands: /new <title>, /tasks, /focus [taskId], /next, /prev, /cancel, /pause, /resume, /continue <msg>, /replay [taskId], /replay-raw [taskId], /verbose, /exit'
        )
        return
      }

      case 'verbose': {
        const arg = (args[0] ?? '').toLowerCase()
        const shouldEnable = arg === 'on' || arg === '1' || arg === 'true'
        const shouldDisable = arg === 'off' || arg === '0' || arg === 'false'

        if (!arg) {
          ctx.setShowVerbose((previous: boolean) => !previous)
          ctx.setStatus('Verbose output toggled')
          return
        }

        if (shouldEnable) {
          ctx.setShowVerbose(true)
          ctx.setStatus('Verbose output enabled')
          return
        }

        if (shouldDisable) {
          ctx.setShowVerbose(false)
          ctx.setStatus('Verbose output disabled')
          return
        }

        ctx.setStatus('Usage: /verbose [on|off]')
        return
      }

      case 'exit':
      case 'q':
      case 'quit': {
        process.exit(0)
      }

      default: {
        ctx.setStatus(`Unknown command: /${command}`)
      }
    }
  } catch (e) {
    ctx.setStatus(e instanceof Error ? e.message : String(e))
  }
}

async function resolveTargetTaskId(explicitTaskId: string | undefined, ctx: CommandContext): Promise<string | null> {
  const trimmed = explicitTaskId?.trim()
  if (trimmed) return trimmed
  if (ctx.focusedTaskId) return ctx.focusedTaskId
  const state = await ctx.app.taskService.listTasks()
  if (state.tasks.length === 0) return null
  const sorted = [...state.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return sorted[0]?.taskId ?? null
}

function buildReplayEntries(message: LLMMessage): ReplayEntry[] {
  const entries: ReplayEntry[] = []

  if (message.role === 'system') {
    if (message.content) {
      entries.push({
        variant: 'plain',
        content: `SYSTEM: ${message.content}`,
        color: 'blue',
        dim: true
      })
    }
  } else if (message.role === 'user') {
    if (message.content) {
      entries.push({
        variant: 'markdown',
        content: message.content,
        prefix: '← ',
        color: 'white',
        bold: true
      })
    }
  } else if (message.role === 'assistant') {
    if (message.reasoning) {
      entries.push({
        variant: 'plain',
        content: message.reasoning,
        prefix: '󰧑 ',
        color: 'gray',
        dim: true
      })
    }
    if (message.content) {
      entries.push({
        variant: 'markdown',
        content: message.content,
        prefix: '→ ',
        color: 'green',
        bold: true
      })
    }
    if (message.toolCalls) {
      for (const toolCall of message.toolCalls) {
        const args = JSON.stringify(toolCall.arguments)
        entries.push({
          variant: 'plain',
          content: `${toolCall.toolName} ${args}`,
          prefix: ' → ',
          color: 'gray',
          dim: true
        })
      }
    }
  } else if (message.role === 'tool') {
    const toolName = message.toolName ?? 'unknown'
    const content = message.content ?? ''
    const parsed = tryParseJson(content)
    
    // Determine if error
    let isError = false
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      isError = record.isError === true || typeof record.error === 'string'
    }

    const display = formatToolOutput(toolName, parsed)
    const prefix = isError ? ' ✖ ' : ' ✓ '
    const color = isError ? 'red' : 'gray'
    const bold = isError

    entries.push({
      variant: 'plain',
      content: `${toolName} result: ${display}`,
      prefix,
      color,
      bold,
      dim: !isError
    })
  }

  return entries
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

async function readConversationRawLines(path: string): Promise<string[]> {
  try {
    await access(path)
  } catch {
    return []
  }
  const raw = await readFile(path, 'utf8')
  return raw.split('\n').filter((line) => line.trim().length > 0)
}
