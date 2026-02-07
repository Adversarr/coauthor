import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput, useStdout, Static } from 'ink'
import { parse, setOptions } from 'marked'
import type { Renderer } from 'marked'
import TerminalRenderer from 'marked-terminal'
import TextInput from 'ink-text-input'
import type { App } from '../app/createApp.js'
import { InteractionPanel } from './components/InteractionPanel.js'
import type { StoredAuditEntry } from '../domain/ports/auditLog.js'
import type { UserInteractionRequestedPayload } from '../domain/events.js'
import { handleCommand } from './commands.js'
import type { ReplayEntry } from './commands.js'

type Props = {
  app: App
}

type PlainStaticEntry = {
  id: string
  variant: 'plain'
  lines: string[]
  color?: string
  dim?: boolean
  bold?: boolean
}

type MarkdownStaticEntry = {
  id: string
  variant: 'markdown'
  prefix?: string
  content: string
  color?: string
  dim?: boolean
  bold?: boolean
}

type StaticEntry = PlainStaticEntry | MarkdownStaticEntry

function renderMarkdownToTerminalText(markdown: string, width: number): string {
  if (!markdown) return ''
  const safeWidth = Math.max(20, width)
  const renderer = new TerminalRenderer({
    width: safeWidth,
    reflowText: true,
    showSectionPrefix: false
  }) as unknown as Renderer
  setOptions({
    renderer
  })
  return parse(markdown).trimEnd()
}

export function MainTui(props: Props) {
  const { app } = props
  const { stdout } = useStdout()
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<string>('')
  const [tasks, setTasks] = useState<Array<{ taskId: string; title: string; status: string }>>([])
  const [completedEntries, setCompletedEntries] = useState<StaticEntry[]>([])
  const [pendingInteraction, setPendingInteraction] = useState<UserInteractionRequestedPayload | null>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [showTasks, setShowTasks] = useState(false)
  const [showVerbose, setShowVerbose] = useState(false)
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0)
  const logSequence = useRef(0)
  const hasAutoOpenedTasks = useRef(false)
  const showVerboseRef = useRef(false)

  useEffect(() => {
    showVerboseRef.current = showVerbose
  }, [showVerbose])

  const addPlainLog = (
    content: string,
    options: { prefix?: string; color?: string; dim?: boolean; bold?: boolean } = {}
  ): void => {
    setCompletedEntries((previousEntries) => {
      const lines = content.split('\n').map((line, index) => {
        if (index === 0 && options.prefix) {
          return `${options.prefix}${line}`
        }
        return line
      })
      const nextEntry: PlainStaticEntry = {
        id: `${Date.now()}-${logSequence.current++}`,
        variant: 'plain',
        lines,
        color: options.color,
        dim: options.dim,
        bold: options.bold
      }
      const nextEntries = [...previousEntries, nextEntry]
      // Cap at 2000 entries to prevent memory bloat in very long sessions
      return nextEntries.slice(-2000)
    })
  }

  const addMarkdownLog = (
    content: string,
    options: { prefix?: string; color?: string; dim?: boolean; bold?: boolean } = {}
  ): void => {
    setCompletedEntries((previousEntries) => {
      const nextEntry: MarkdownStaticEntry = {
        id: `${Date.now()}-${logSequence.current++}`,
        variant: 'markdown',
        prefix: options.prefix,
        content,
        color: options.color,
        dim: options.dim,
        bold: options.bold
      }
      const nextEntries = [...previousEntries, nextEntry]
      return nextEntries.slice(-2000)
    })
  }

  const setReplayOutput = (entries: ReplayEntry[]): void => {
    for (const entry of entries) {
      if (entry.variant === 'markdown') {
        addMarkdownLog(entry.content, {
          prefix: entry.prefix,
          color: entry.color,
          dim: entry.dim,
          bold: entry.bold
        })
      } else {
        addPlainLog(entry.content, {
          prefix: entry.prefix,
          color: entry.color,
          dim: entry.dim,
          bold: entry.bold
        })
      }
    }
  }

  const refresh = async (): Promise<void> => {
    try {
      const result = await app.taskService.listTasks()
      const taskList = result.tasks.map((task) => ({
        taskId: task.taskId,
        title: task.title,
        status: task.status
      }))
      setTasks(taskList)

      if (focusedTaskId) {
        const stillExists = taskList.some((task) => task.taskId === focusedTaskId)
        if (!stillExists) setFocusedTaskId(null)
      }

      if (showTasks) {
        const currentIndex = focusedTaskId
          ? Math.max(0, taskList.findIndex((t) => t.taskId === focusedTaskId))
          : 0
        setSelectedTaskIndex((prev) => {
          const clamped = Math.min(Math.max(prev, 0), Math.max(0, taskList.length - 1))
          return Number.isFinite(clamped) ? clamped : currentIndex
        })
      }

      const awaitingTask = result.tasks.find((task) => task.status === 'awaiting_user')
      if (awaitingTask) {
        const pending = app.interactionService.getPendingInteraction(awaitingTask.taskId)
        setPendingInteraction(pending)
        if (pending && focusedTaskId !== awaitingTask.taskId) {
          setFocusedTaskId(awaitingTask.taskId)
        }
      } else {
        setPendingInteraction(null)
      }

      if (!awaitingTask && !hasAutoOpenedTasks.current && taskList.length > 0) {
        hasAutoOpenedTasks.current = true
        setShowTasks(true)
        const initialIndex = focusedTaskId
          ? Math.max(0, taskList.findIndex((t) => t.taskId === focusedTaskId))
          : 0
        setSelectedTaskIndex(initialIndex)
      }
    } catch (e) {
      addPlainLog(`Failed to refresh: ${e}`, { color: 'red' })
    }
  }

  useEffect(() => {
    app.runtimeManager.start()
    refresh().catch((e) => setStatus(e instanceof Error ? e.message : String(e)))
    addPlainLog('Welcome to CoAuthor. Type /help for commands.', { color: 'cyan', dim: true })

    const storeSub = app.store.events$.subscribe(() => {
      refresh().catch(console.error)
    })
    
    const uiBusSub = app.uiBus.events$.subscribe((event) => {
      if (event.type === 'agent_output') {
        if (event.payload.kind === 'reasoning') {
          addPlainLog(event.payload.content, { prefix: '󰧑 ', color: 'gray', dim: true })
        } else if (event.payload.kind === 'verbose') {
          if (showVerboseRef.current) {
            addPlainLog(event.payload.content, { prefix: '· ', color: 'gray', dim: true })
          }
        } else if (event.payload.kind === 'error') {
          addPlainLog(event.payload.content, { prefix: '✖ ', color: 'red', bold: true })
        } else {
          addMarkdownLog(event.payload.content, { prefix: '→ ', color: 'green', bold: true })
        }
      }
      if (event.type === 'audit_entry') {
        const formatted = formatAuditEntry(event.payload)
        addPlainLog(formatted.line, {
          color: formatted.color,
          dim: formatted.dim,
          bold: formatted.bold
        })
      }
    })
    return () => {
      uiBusSub.unsubscribe()
      storeSub.unsubscribe()
      app.runtimeManager.stop()
    }
  }, [])

  const onInteractionSubmit = async (optionId?: string, inputValue?: string): Promise<void> => {
    if (!pendingInteraction) return
    try {
      const option = pendingInteraction.options?.find(o => o.id === optionId)
      const summary = optionId 
        ? `Selected: ${option?.label || optionId}` 
        : `Input: ${inputValue || ''}`
      addPlainLog(summary, { prefix: '← ', color: 'white' })
      
      await app.interactionService.respondToInteraction(
        pendingInteraction.taskId,
        pendingInteraction.interactionId,
        { selectedOptionId: optionId, inputValue }
      )
      setPendingInteraction(null)
      await refresh()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const onSubmit = async (line: string): Promise<void> => {
    const trimmed = line.trim()
    setInput('')
    if (!trimmed) return

    addPlainLog(trimmed, { prefix: '← ', color: 'white', bold: true })

    const effectiveCommandLine = buildCommandLineFromInput({
      input: trimmed,
      focusedTaskId,
      tasks
    })

    await handleCommand(effectiveCommandLine, {
      app,
      refresh,
      setStatus,
      setReplayOutput,
      focusedTaskId,
      setFocusedTaskId,
      setShowTasks,
      setShowVerbose
    })
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'd') {
      process.exit(0)
    }
    if (key.escape) {
      if (showTasks) setShowTasks(false)
    }
    if (showTasks && tasks.length > 0) {
      if (key.upArrow) {
        setSelectedTaskIndex((prev) => Math.max(0, prev - 1))
      } else if (key.downArrow) {
        setSelectedTaskIndex((prev) => Math.min(tasks.length - 1, prev + 1))
      } else if (key.return) {
        const chosen = tasks[selectedTaskIndex]
        if (chosen) {
          setFocusedTaskId(chosen.taskId)
          setShowTasks(false)
          setStatus(`Focused: ${chosen.taskId}`)
        }
      }
    }
  })

  const focusedTask = tasks.find((task) => task.taskId === focusedTaskId)
  const taskTitle = focusedTask ? focusedTask.title : '(no task focused)'
  const taskStatus = focusedTask ? focusedTask.status : ''
  const statusIcon = getStatusIcon(taskStatus)
  const columns = stdout?.columns ?? 80
  const rows = stdout?.rows ?? 24
  const statusLine = truncateText(status || '', columns - 2)
  const separatorLine = createSeparatorLine(columns)

  return (
    <Box flexDirection="column">
      {/* Permanent output - printed once, persists in terminal scrollback */}
      <Static items={completedEntries}>
        {(entry) => (
          <Box key={entry.id} flexDirection="column" paddingX={1}>
            {entry.variant === 'plain' ? (
              entry.lines.map((line, index) => (
                <Text
                  key={`${entry.id}-${index}`}
                  color={entry.color}
                  dimColor={entry.dim}
                  bold={entry.bold}
                >
                  {line}
                </Text>
              ))
            ) : (
              <Text color={entry.color} dimColor={entry.dim} bold={entry.bold}>
                {entry.prefix ?? ''}
                {renderMarkdownToTerminalText(entry.content, columns - 4)}
              </Text>
            )}
          </Box>
        )}
      </Static>

      {showTasks ? (
        <Box flexDirection="column" paddingX={1}>
          <Box borderStyle="double" borderColor="white" flexDirection="column" padding={1}>
            <Text bold underline>
              Tasks (Press ESC to close)
            </Text>
            <Text dimColor>{statusLine || ' '}</Text>
            <Box flexDirection="column" marginTop={1}>
              {(() => {
                const maximumTaskRows = Math.max(0, rows - 7)
                const visibleTasks = tasks.slice(0, maximumTaskRows)
                const hiddenTaskCount = Math.max(0, tasks.length - visibleTasks.length)

                return (
                  <>
                    {visibleTasks.map((task) => {
                      const isFocused = task.taskId === focusedTaskId
                      const isSelected = tasks.indexOf(task) === selectedTaskIndex
                      const taskSuffix = ` (${task.status}) [${task.taskId}]`
                      const availableTitleWidth = Math.max(0, columns - taskSuffix.length - 6)
                      const truncatedTitle = truncateText(task.title, availableTitleWidth)

                      return (
                        <Box key={task.taskId}>
                          <Text color={isFocused ? 'green' : isSelected ? 'blue' : 'white'} bold={isFocused || isSelected}>
                            {isSelected ? '> ' : '  '}
                            {truncatedTitle}
                          </Text>
                          <Text dimColor>{` ${getStatusIcon(task.status)}${taskSuffix}`}</Text>
                        </Box>
                      )
                    })}
                    {hiddenTaskCount > 0 ? (
                      <Text dimColor>{`… and ${hiddenTaskCount} more`}</Text>
                    ) : null}
                  </>
                )
              })()}
            </Box>
          </Box>
        </Box>
      ) : (
        <>
          <Text dimColor>{separatorLine}</Text>
          <Box flexDirection="column" paddingX={1}>
            <Text color="yellow">{statusLine || ' '}</Text>

            {pendingInteraction ? (
              <InteractionPanel pendingInteraction={pendingInteraction} onSubmit={onInteractionSubmit} />
            ) : (
              <Box>
                <Text color="cyan">{'> '}</Text>
                <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
              </Box>
            )}
          </Box>

          <Text dimColor>{separatorLine}</Text>
          <Box height={1} width="100%" paddingX={1}>
            <Box flexGrow={1}>
              <Text color="cyan" bold>
                CoAuthor
              </Text>
              <Text dimColor> │ </Text>
              <Text color="yellow">FOCUSED: </Text>
              <Text bold>{taskTitle}</Text>
              <Text> {statusIcon} </Text>
            </Box>
            <Text color="green">[●]</Text>
          </Box>
        </>
      )}
    </Box>
  )
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'open': return '⚪'
    case 'in_progress': return '🔵'
    case 'awaiting_user': return '🟡'
    case 'paused': return '⏸️'
    case 'done': return '🟢'
    case 'failed': return '🔴'
    case 'canceled': return '⚪'
    default: return ' '
  }
}

const toolFormatters: Record<string, (output: any) => string | null> = {
  readFile: (output: any) => {
    if (output && typeof output.path === 'string' && typeof output.lineCount === 'number') {
      return `Read ${output.path} (${output.lineCount} lines)`
    }
    return null
  },
  listFiles: (output: any) => {
    if (output && typeof output.path === 'string' && typeof output.count === 'number') {
      return `List ${output.path} (${output.count} entries)`
    }
    return null
  }
}

function formatAuditEntry(entry: StoredAuditEntry): {
  line: string
  color?: string
  dim?: boolean
  bold?: boolean
} {
  if (entry.type === 'ToolCallRequested') {
    const input = formatToolPayload(entry.payload.input, 200)
    return {
      line: ` → ${entry.payload.toolName} ${input}`,
      color: 'gray',
      dim: true
    }
  }

  let output: string
  const formatter = toolFormatters[entry.payload.toolName]
  const formattedCustom = formatter ? formatter(entry.payload.output) : null

  if (formattedCustom) {
    output = formattedCustom
  } else {
    output = formatToolPayload(entry.payload.output, 200)
  }

  if (entry.payload.isError) {
    return {
      line: ` ✖ ${entry.payload.toolName} error (${entry.payload.durationMs}ms) ${output}`,
      color: 'red',
      bold: true
    }
  }
  return {
    line: ` ✓ ${entry.payload.toolName} ok (${entry.payload.durationMs}ms) ${output}`,
    color: 'gray',
    dim: true
  }
}

function formatToolPayload(value: unknown, maxLength: number): string {
  if (typeof value === 'string') {
    return truncateLongString(value, maxLength)
  }
  const raw = JSON.stringify(value)
  return typeof raw === 'string' ? raw : String(value)
}

function truncateLongString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const suffix = '...(truncated)'
  const sliceLength = Math.max(0, maxLength - suffix.length)
  return value.slice(0, sliceLength) + suffix
}

function createSeparatorLine(columns: number): string {
  const width = Math.max(0, columns)
  return '─'.repeat(width)
}

function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if (value.length <= maxLength) return value
  return value.slice(0, Math.max(0, maxLength - 1)) + '…'
}

function buildCommandLineFromInput(opts: {
  input: string
  focusedTaskId: string | null
  tasks: Array<{ taskId: string; title: string; status: string }>
}): string {
  const trimmed = opts.input.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/')) return trimmed

  if (!opts.focusedTaskId) {
    return `/new ${trimmed}`
  }

  const focusedTask = opts.tasks.find((task) => task.taskId === opts.focusedTaskId)
  const focusedTaskStatus = focusedTask?.status

  if (focusedTaskStatus === 'awaiting_user') {
    return `/continue ${trimmed}`
  }

  return `/continue ${trimmed}`
}
