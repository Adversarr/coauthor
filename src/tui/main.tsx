import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput, useStdout, Static } from 'ink'
import TextInput from 'ink-text-input'
import type { App } from '../app/createApp.js'
import { InteractionPanel } from './components/InteractionPanel.js'
import type { StoredAuditEntry } from '../domain/ports/auditLog.js'
import type { UserInteractionRequestedPayload } from '../domain/events.js'
import { handleCommand } from './commands.js'

type Props = {
  app: App
}

type StaticEntry = {
  id: string
  lines: string[]
  color?: string
  dim?: boolean
  bold?: boolean
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
  const logSequence = useRef(0)
  const hasAutoOpenedTasks = useRef(false)

  const addLog = (
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
      const nextEntry: StaticEntry = {
        id: `${Date.now()}-${logSequence.current++}`,
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

  const setReplayOutput = (lines: string[]): void => {
    for (const line of lines) {
      addLog(line, { color: 'cyan', dim: true })
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
      }
    } catch (e) {
      addLog(`Failed to refresh: ${e}`, { color: 'red' })
    }
  }

  useEffect(() => {
    app.agentRuntime.start()
    refresh().catch((e) => setStatus(e instanceof Error ? e.message : String(e)))
    addLog('Welcome to CoAuthor. Type /help for commands.', { color: 'cyan', dim: true })

    const storeSub = app.store.events$.subscribe(() => {
      refresh().catch(console.error)
    })
    
    const uiBusSub = app.uiBus.events$.subscribe((event) => {
      if (event.type === 'agent_output') {
        const isThinking = event.payload.kind === 'reasoning'
        if (isThinking) {
          addLog(event.payload.content, {
            prefix: '󰧑 ',
            color: 'yellow',
            dim: true
          })
        } else {
          addLog(event.payload.content, {
            prefix: '󰍥 ',
            // color: 'green'
          })
        }
      }
      if (event.type === 'audit_entry') {
        const line = formatAuditEntry(event.payload)
        addLog(line, { color: 'cyan', dim: true })
      }
    })
    return () => {
      uiBusSub.unsubscribe()
      storeSub.unsubscribe()
      app.agentRuntime.stop()
    }
  }, [])

  const onInteractionSubmit = async (optionId?: string, inputValue?: string): Promise<void> => {
    if (!pendingInteraction) return
    try {
      const option = pendingInteraction.options?.find(o => o.id === optionId)
      const summary = optionId 
        ? `Selected: ${option?.label || optionId}` 
        : `Input: ${inputValue || ''}`
      addLog(summary, { prefix: '← ', color: 'white' })
      
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

    addLog(trimmed, { prefix: '← ', color: 'white', bold: true })

    await handleCommand(trimmed, {
      app,
      refresh,
      setStatus,
      setReplayOutput,
      focusedTaskId,
      setFocusedTaskId,
      setShowTasks
    })
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'd') {
      process.exit(0)
    }
    if (key.escape) {
      if (showTasks) setShowTasks(false)
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
            {entry.lines.map((line, index) => (
              <Text
                key={`${entry.id}-${index}`}
                color={entry.color}
                dimColor={entry.dim}
                bold={entry.bold}
              >
                {line}
              </Text>
            ))}
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
                      const taskSuffix = ` (${task.status}) [${task.taskId}]`
                      const availableTitleWidth = Math.max(0, columns - taskSuffix.length - 6)
                      const truncatedTitle = truncateText(task.title, availableTitleWidth)

                      return (
                        <Box key={task.taskId}>
                          <Text color={isFocused ? 'green' : 'white'} bold={isFocused}>
                            {isFocused ? '> ' : '  '}
                            {truncatedTitle}
                          </Text>
                          <Text dimColor>{taskSuffix}</Text>
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
    case 'running': return '🔵'
    case 'awaiting_user': return '🟡'
    case 'paused': return '⏸️'
    case 'completed': return '🟢'
    case 'failed': return '🔴'
    case 'cancelled': return '⚪'
    default: return ''
  }
}

function formatAuditEntry(entry: StoredAuditEntry): string {
  if (entry.type === 'ToolCallRequested') {
    const input = truncateJson(entry.payload.input, 200)
    return ` → ${entry.payload.toolName} ${input}`
  }
  const result = entry.payload.isError ? 'error' : 'ok'
  const output = truncateJson(entry.payload.output, 200)
  return ` ✓ ${entry.payload.toolName} ${result} (${entry.payload.durationMs}ms) ${output}`
}

function truncateJson(value: unknown, maxLength: number): string {
  const raw = JSON.stringify(value)
  if (raw.length <= maxLength) return raw
  return raw.slice(0, maxLength) + '…'
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
