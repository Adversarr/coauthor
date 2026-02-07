import { existsSync, readFileSync } from 'node:fs'
import type { LLMMessage } from '../domain/ports/llmClient.js'
import type { App } from '../app/createApp.js'

export type ReplayEntry = {
  variant: 'plain' | 'markdown'
  content: string
  prefix?: string
  color?: string
  dim?: boolean
  bold?: boolean
}

const TOOL_OUTPUT_MAX = 200
const TOOL_OUTPUT_SUFFIX = '...(truncated)'

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
        const exists = ctx.app.taskService.getTask(targetId)
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
        const state = ctx.app.taskService.listTasks()
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
        const targetId = resolveTargetTaskId(args[0], ctx)
        if (!targetId) {
          ctx.setStatus('No task found to replay')
          return
        }
        const messages = ctx.app.conversationStore.getMessages(targetId)
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
        const targetId = resolveTargetTaskId(args[0], ctx)
        const rawLines = readConversationRawLines(ctx.app.conversationsPath)
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

function resolveTargetTaskId(explicitTaskId: string | undefined, ctx: CommandContext): string | null {
  const trimmed = explicitTaskId?.trim()
  if (trimmed) return trimmed
  if (ctx.focusedTaskId) return ctx.focusedTaskId
  const state = ctx.app.taskService.listTasks()
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
    const formatted = formatToolContent(content)
    const prefix = formatted.isError ? ' ✖ ' : ' ✓ '
    const color = formatted.isError ? 'red' : 'gray'
    const bold = formatted.isError
    entries.push({
      variant: 'plain',
      content: `${toolName} result: ${formatted.display}`,
      prefix,
      color,
      bold,
      dim: !formatted.isError
    })
  }

  return entries
}

function formatToolContent(content: string): { display: string; isError: boolean } {
  const parsed = tryParseJson(content)
  if (typeof parsed === 'string') {
    return { display: truncateLongString(parsed), isError: false }
  }
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    const isError = record.isError === true || typeof record.error === 'string'
    return { display: JSON.stringify(parsed), isError }
  }
  return { display: String(parsed), isError: false }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function truncateLongString(value: string): string {
  if (value.length <= TOOL_OUTPUT_MAX) return value
  const sliceLength = Math.max(0, TOOL_OUTPUT_MAX - TOOL_OUTPUT_SUFFIX.length)
  return value.slice(0, sliceLength) + TOOL_OUTPUT_SUFFIX
}

function readConversationRawLines(path: string): string[] {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  return raw.split('\n').filter((line) => line.trim().length > 0)
}
