import React, { useEffect, useRef, useState } from 'react'
import { Box, useInput, useStdout } from 'ink'
import type { App } from '../app/createApp.js'
import { InteractionPane } from './components/InteractionPane.js'
import type { UserInteractionRequestedPayload } from '../domain/events.js'
import { handleCommand } from './commands.js'
import type { ReplayEntry } from './commands.js'

import type { PlainStaticEntry, MarkdownStaticEntry, StaticEntry, TaskView } from './types.js'
import {
  formatAuditEntry,
  truncateText,
  createSeparatorLine,
  buildCommandLineFromInput,
  sortTasksAsTree,
  computeTaskDepths,
  buildBreadcrumb
} from './utils.js'
import { LogOutput } from './components/LogOutput.js'
import { TaskPane } from './components/TaskPane.js'
import { StreamingOutput } from './components/StreamingOutput.js'

type Props = {
  app: App
}

export function MainTui(props: Props) {
  const { app } = props
  const { stdout } = useStdout()
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<string>('')
  const [tasks, setTasks] = useState<TaskView[]>([])
  const [completedEntries, setCompletedEntries] = useState<StaticEntry[]>([])
  const [pendingInteraction, setPendingInteraction] = useState<UserInteractionRequestedPayload | null>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [showTasks, setShowTasks] = useState(false)
  const [showVerbose, setShowVerbose] = useState(false)
  const [streamingEnabled, setStreamingEnabled] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0)
  const logSequence = useRef(0)
  const hasAutoOpenedTasks = useRef(false)
  const showVerboseRef = useRef(false)
  
  // Refs to track state in closures (like refresh)
  const focusedTaskIdRef = useRef<string | null>(null)
  const lastTasksRef = useRef<TaskView[]>([])
  // Refs to track streaming content synchronously (avoids nested setState)
  const streamingTextRef = useRef('')
  const streamingReasoningRef = useRef('')

  useEffect(() => {
    showVerboseRef.current = showVerbose
  }, [showVerbose])

  useEffect(() => {
    focusedTaskIdRef.current = focusedTaskId
    // Clear streaming buffers on focus change
    streamingTextRef.current = ''
    streamingReasoningRef.current = ''
    setStreamingText('')
    setStreamingReasoning('')
  }, [focusedTaskId])

  const addPlainLog = (
    content: string,
    options: { prefix?: string; color?: string; dim?: boolean; bold?: boolean } = {}
  ): void => {
    setCompletedEntries((previousEntries) => {
      const prefix = options.prefix ?? ''
      const lines = content.split('\n').map((line) => `${prefix}${line}`)
      const nextEntry: PlainStaticEntry = {
        id: `${Date.now()}-${logSequence.current++}`,
        variant: 'plain',
        lines,
        color: options.color,
        dim: options.dim,
        bold: options.bold
      }
      const nextEntries = [...previousEntries, nextEntry]
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

      // Compute depths for enriched TaskView
      const rawTasks = result.tasks.map((task) => ({
        taskId: task.taskId,
        title: task.title,
        status: task.status,
        parentTaskId: task.parentTaskId,
        agentId: task.agentId,
        childTaskIds: task.childTaskIds,
        depth: 0,
        summary: task.summary,
        failureReason: task.failureReason
      }))
      const depthMap = computeTaskDepths(rawTasks)
      for (const t of rawTasks) t.depth = depthMap.get(t.taskId) ?? 0

      // Sort into tree order (parents before children)
      const taskList = sortTasksAsTree(rawTasks)
      setTasks(taskList)

      // --- 1. Detect new subtasks and auto-focus ---
      // If a new task is created and its parent is currently focused, switch focus to the child.
      const currentFocusedId = focusedTaskIdRef.current
      if (currentFocusedId) {
        const previousTaskIds = new Set(lastTasksRef.current.map(t => t.taskId))
        const newChildTask = taskList.find(t => 
          !previousTaskIds.has(t.taskId) && // It is new
          t.parentTaskId === currentFocusedId // Parent is currently focused
        )
        
        if (newChildTask) {
          setFocusedTaskId(newChildTask.taskId)
          // Update ref immediately for subsequent logic in this tick
          focusedTaskIdRef.current = newChildTask.taskId 
        }
      }
      
      // Update lastTasksRef for next refresh
      lastTasksRef.current = taskList

      // --- 2. Check if focused task still exists ---
      if (focusedTaskIdRef.current) {
        const stillExists = taskList.some((task) => task.taskId === focusedTaskIdRef.current)
        if (!stillExists) setFocusedTaskId(null)
      }

      if (showTasks) {
        const currentIndex = focusedTaskIdRef.current
          ? Math.max(0, taskList.findIndex((t) => t.taskId === focusedTaskIdRef.current))
          : 0
        setSelectedTaskIndex((prev) => {
          const clamped = Math.min(Math.max(prev, 0), Math.max(0, taskList.length - 1))
          return Number.isFinite(clamped) ? clamped : currentIndex
        })
      }

      // --- Auto-focus subtasks / return-to-parent ---
      // Priority: awaiting_user subtask > awaiting_user root > in_progress subtask

      const awaitingTask = result.tasks.find((task) => task.status === 'awaiting_user')
      if (awaitingTask) {
        const pending = await app.interactionService.getPendingInteraction(awaitingTask.taskId)
        setPendingInteraction(pending)
        if (pending && focusedTaskIdRef.current !== awaitingTask.taskId) {
          // Push current focus before switching (implicit stack via parentTaskId)
          setFocusedTaskId(awaitingTask.taskId)
        }
      } else {
        setPendingInteraction(null)

        // If the currently focused task just completed and has a parent, pop back
        const focusedTask = taskList.find((t) => t.taskId === focusedTaskIdRef.current)
        if (
          focusedTask &&
          focusedTask.parentTaskId &&
          ['done', 'failed', 'canceled'].includes(focusedTask.status)
        ) {
          setFocusedTaskId(focusedTask.parentTaskId)
        }

        // If no task focused, auto-focus the first in_progress subtask (or root task)
        if (!focusedTaskIdRef.current || !taskList.some((t) => t.taskId === focusedTaskIdRef.current)) {
          const active = taskList.find(
            (t) => t.status === 'in_progress' || t.status === 'awaiting_user'
          )
          if (active) {
            setFocusedTaskId(active.taskId)
          }
        }
      }

      if (!awaitingTask && !hasAutoOpenedTasks.current && taskList.length > 0) {
        hasAutoOpenedTasks.current = true
        setShowTasks(true)
        const initialIndex = focusedTaskIdRef.current
          ? Math.max(0, taskList.findIndex((t) => t.taskId === focusedTaskIdRef.current))
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
    addPlainLog('Welcome to CoAuthor — multi-agent coding assistant. Type /help for commands, /agent to list agents.', { color: 'cyan', dim: true })

    const storeSub = app.store.events$.subscribe(() => {
      refresh().catch(console.error)
    })
    
    const uiBusSub = app.uiBus.events$.subscribe((event) => {
      if (event.type === 'agent_output') {
        // Only show agent_output for focused task (or all if no focus)
        const focused = focusedTaskIdRef.current
        if (focused && event.payload.taskId !== focused) return

        if (event.payload.kind === 'reasoning') {
          addPlainLog(event.payload.content, { prefix: '󰧑 ', color: 'gray', dim: true })
        } else if (event.payload.kind === 'verbose') {
          if (showVerboseRef.current) {
            addPlainLog(event.payload.content, { prefix: '· ', color: 'gray', dim: true })
          }
        } else if (event.payload.kind === 'error') {
          addPlainLog(event.payload.content, { prefix: '✖ ', color: 'red', bold: true })
        } else if (event.payload.kind === 'text') {
          addMarkdownLog(event.payload.content, { prefix: '→ ', color: 'green', bold: true })
        } else {
          addPlainLog(event.payload.content, { prefix: '? ' })
        }
      }
      if (event.type === 'stream_delta') {
        const focused = focusedTaskIdRef.current
        if (focused && event.payload.taskId !== focused) return
        if (event.payload.kind === 'text') {
          streamingTextRef.current += event.payload.content
          setStreamingText(streamingTextRef.current)
        } else if (event.payload.kind === 'reasoning') {
          streamingReasoningRef.current += event.payload.content
          setStreamingReasoning(streamingReasoningRef.current)
        }
      }
      if (event.type === 'stream_end') {
        const focused = focusedTaskIdRef.current
        if (focused && event.payload.taskId !== focused) return
        // Read from refs (synchronous) — avoids nested setState ordering issues
        const reasoningContent = streamingReasoningRef.current
        const textContent = streamingTextRef.current
        // Commit in correct order: reasoning first, then text
        if (reasoningContent) addPlainLog(reasoningContent, { prefix: '󰧑 ', color: 'gray', dim: true })
        if (textContent) addMarkdownLog(textContent, { prefix: '→ ', color: 'green', bold: true })
        // Clear buffers
        streamingReasoningRef.current = ''
        streamingTextRef.current = ''
        setStreamingReasoning('')
        setStreamingText('')
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
      setShowVerbose,
      setStreamingEnabled: (val: boolean | ((prev: boolean) => boolean)) => {
        setStreamingEnabled(val)
      }
    })
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'd') {
      process.exit(0)
    }
    if (key.escape) {
      if (showTasks) setShowTasks(false)
    }
    // Tab toggles task list
    if (key.tab) {
      setShowTasks((prev) => !prev)
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
  const breadcrumb = buildBreadcrumb(tasks, focusedTaskId)
  const columns = stdout?.columns ?? 80
  const rows = stdout?.rows ?? 24
  const statusLine = truncateText(status || '', columns - 2)
  const separatorLine = createSeparatorLine(columns)
  const activeAgentId = app.runtimeManager.defaultAgentId
  const activeProfile = app.runtimeManager.getProfileOverride('*') ?? undefined

  return (
    <Box flexDirection="column">
      {/* Permanent output - printed once, persists in terminal scrollback */}
      <LogOutput entries={completedEntries} width={columns} />

      {/* Live streaming output (only during active streaming) */}
      <StreamingOutput
        streamingText={streamingText}
        streamingReasoning={streamingReasoning}
        width={columns}
      />

      {showTasks ? (
        <TaskPane
          tasks={tasks}
          focusedTaskId={focusedTaskId}
          selectedTaskIndex={selectedTaskIndex}
          rows={rows}
          columns={columns}
          statusLine={statusLine}
          breadcrumb={breadcrumb}
        />
      ) : (
        <InteractionPane
          separatorLine={separatorLine}
          statusLine={statusLine}
          pendingInteraction={pendingInteraction}
          onInteractionSubmit={onInteractionSubmit}
          inputValue={input}
          onInputChange={setInput}
          onInputSubmit={onSubmit}
          focusedTask={focusedTask}
          columns={columns}
          breadcrumb={breadcrumb}
          activeAgentId={activeAgentId}
          activeProfile={activeProfile}
        />
      )}
    </Box>
  )
}
