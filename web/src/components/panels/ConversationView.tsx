/**
 * ConversationView — replay-only chat interface for persisted task conversation history.
 *
 * Renders stored LLM messages with true interleaved parts ordering and tool pairing.
 * No live stream chunks are rendered in the web UI.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/utils'
import { useConversationStore, type ConversationMessage, type MessagePart } from '@/stores/conversationStore'
import { useTaskStore } from '@/stores/taskStore'
import {
  formatToolInputHeaderSummary,
  formatToolInputSummary,
  formatToolOutputSummary,
  getToolDisplayName,
  isInternalTool
} from '@/lib/toolPresentation'
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Task, TaskTrigger, TaskContent, TaskItem } from '@/components/ai-elements/task'
import { StatusBadge } from '@/components/display/StatusBadge'
import {
  Bot, User, MessageSquare, GitBranch,
} from 'lucide-react'

/** Smarter error detection that avoids false positives like "No errors found". */
function detectToolError(content: string, isError?: boolean): boolean {
  if (typeof isError === 'boolean') return isError

  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === 'object' && parsed !== null) {
      if ('isError' in parsed && parsed.isError === true) return true
      if ('error' in parsed && typeof parsed.error === 'string' && parsed.error.length > 0) return true
    }
    return false
  } catch {
    const lower = content.toLowerCase()
    return /^(error:|fatal:|exception:|failed to |cannot |unable to )/i.test(content.trim())
      || (lower.includes('"error"') && lower.includes('true'))
  }
}

function TextPart({ content }: { content: string }) {
  return <MessageResponse>{content}</MessageResponse>
}

function ReasoningPart({ content, defaultOpen = false }: { content: string; defaultOpen?: boolean }) {
  return (
    <Reasoning defaultOpen={defaultOpen}>
      <ReasoningTrigger />
      <ReasoningContent>{content}</ReasoningContent>
    </Reasoning>
  )
}

type ToolCallResult = { content: string; isError?: boolean }

type ToolCallRenderModel = {
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
  result?: ToolCallResult
}

type AssistantRenderBlock =
  | { kind: 'text'; key: string; content: string }
  | { kind: 'reasoning'; key: string; content: string }
  | { kind: 'tool_result'; key: string; toolName?: string; content: string }
  | { kind: 'tool_call_single'; key: string; call: ToolCallRenderModel }
  | { kind: 'tool_call_group'; key: string; toolName: string; calls: ToolCallRenderModel[] }

function isSuccessfulInternalToolCall(call: ToolCallRenderModel): boolean {
  if (!isInternalTool(call.toolName)) return false
  if (!call.result) return false
  return !detectToolError(call.result.content, call.result.isError)
}

function summarizeGroupedInput(toolName: string, calls: ToolCallRenderModel[]): string {
  const previews = calls.slice(0, 2).map((call) => formatToolInputHeaderSummary(toolName, call.arguments))
  if (calls.length <= 2) return previews.join(' | ')
  return `${previews.join(' | ')} | +${calls.length - 2} more`
}

function GenericToolCallPart({ toolName, arguments: args, result }: {
  toolName: string
  arguments: Record<string, unknown>
  result?: ToolCallResult
}) {
  const hasResult = !!result
  const isError = result ? detectToolError(result.content, result.isError) : false
  const state = hasResult
    ? (isError ? 'output-error' : 'output-available')
    : 'input-available'

  return (
    <Tool>
      <ToolHeader type="dynamic-tool" state={state} toolName={toolName} />
      <ToolContent>
        <ToolInput input={args} />
        {result && (
          <ToolOutput output={result.content} errorText={isError ? result.content : undefined} />
        )}
      </ToolContent>
    </Tool>
  )
}

function FriendlyInternalToolCallPart({ toolName, arguments: args, result }: {
  toolName: string
  arguments: Record<string, unknown>
  result?: ToolCallResult
}) {
  const hasResult = !!result
  const isError = result ? detectToolError(result.content, result.isError) : false
  const state = hasResult
    ? (isError ? 'output-error' : 'output-available')
    : 'input-available'
  const title = getToolDisplayName(toolName)
  const headerSummary = formatToolInputHeaderSummary(toolName, args)
  const inputSummary = formatToolInputSummary(toolName, args)
  const outputSummary = result ? formatToolOutputSummary(toolName, result.content) : null

  return (
    <Tool>
      <ToolHeader
        type="dynamic-tool"
        state={state}
        toolName={toolName}
        title={title}
        summary={headerSummary}
      />
      <ToolContent>
        <div className="rounded-md border border-zinc-800/80 bg-zinc-950/40 px-3 py-2 space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Input</p>
          <p className="text-xs text-zinc-300 whitespace-pre-wrap break-words">{inputSummary}</p>
          {!result && (
            <p className="text-xs text-zinc-500">Status: Running...</p>
          )}
          {result && (
            <p className="text-xs text-zinc-500 whitespace-pre-wrap break-words">
              {isError ? 'Error' : 'Result'}: {outputSummary}
            </p>
          )}
        </div>
        <ToolInput input={args} />
        {result && (
          <ToolOutput output={result.content} errorText={isError ? result.content : undefined} />
        )}
      </ToolContent>
    </Tool>
  )
}

function GroupedInternalToolCallPart({ toolName, calls }: { toolName: string; calls: ToolCallRenderModel[] }) {
  const title = `${getToolDisplayName(toolName)} × ${calls.length}`
  const headerSummary = summarizeGroupedInput(toolName, calls)

  return (
    <Tool>
      <ToolHeader
        type="dynamic-tool"
        state="output-available"
        toolName={toolName}
        title={title}
        summary={headerSummary}
      />
      <ToolContent>
        <p className="text-xs text-zinc-500">
          Grouped consecutive successful calls for readability.
        </p>
        <div className="space-y-3">
          {calls.map((call, index) => {
            const output = call.result?.content ?? ''
            return (
              <div
                key={call.toolCallId}
                className="rounded-md border border-zinc-800/80 bg-zinc-950/40 px-3 py-2 space-y-1"
              >
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Call {index + 1}
                </p>
                <p className="text-xs text-zinc-300 whitespace-pre-wrap break-words">
                  {formatToolInputSummary(toolName, call.arguments)}
                </p>
                <p className="text-xs text-zinc-500 whitespace-pre-wrap break-words">
                  Result: {formatToolOutputSummary(toolName, output)}
                </p>
                <details className="pt-1">
                  <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">
                    Raw input/output
                  </summary>
                  <div className="mt-2 space-y-3">
                    <ToolInput input={call.arguments} />
                    <ToolOutput output={output} errorText={undefined} />
                  </div>
                </details>
              </div>
            )
          })}
        </div>
      </ToolContent>
    </Tool>
  )
}

type GroupSubtaskItem = {
  taskId?: string
  agentId: string
  title: string
  status?: string
  summary?: string
  failureReason?: string
}

function CreateSubtasksToolCallPart({ arguments: args, result }: {
  arguments: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}) {
  const plannedTasks = Array.isArray(args.tasks) ? args.tasks : []
  const waitMode = typeof args.wait === 'string' ? args.wait : 'all'

  const resultItems: GroupSubtaskItem[] = []
  let summaryText: string | undefined
  if (result) {
    try {
      const parsed = JSON.parse(result.content)
      const parsedTasks = Array.isArray(parsed?.tasks) ? parsed.tasks : []
      for (const task of parsedTasks) {
        if (!task || typeof task !== 'object') continue
        resultItems.push({
          taskId: typeof task.taskId === 'string' ? task.taskId : undefined,
          agentId: typeof task.agentId === 'string' ? task.agentId : 'unknown',
          title: typeof task.title === 'string' ? task.title : 'Untitled subtask',
          status: typeof task.status === 'string' ? task.status : undefined,
          summary: typeof task.summary === 'string' ? task.summary : undefined,
          failureReason: typeof task.failureReason === 'string' ? task.failureReason : undefined
        })
      }
      if (parsed?.summary) {
        const success = Number(parsed.summary.success ?? 0)
        const error = Number(parsed.summary.error ?? 0)
        const canceled = Number(parsed.summary.cancel ?? 0)
        summaryText = `${success} success, ${error} error, ${canceled} canceled`
      }
    } catch {
      // Ignore parse errors and render planned tasks only.
    }
  }

  const mergedTasks = useMemo(() => {
    const merged = new Map<string, GroupSubtaskItem>()
    for (const task of plannedTasks) {
      if (!task || typeof task !== 'object') continue
      const agentId = typeof (task as any).agentId === 'string' ? (task as any).agentId : 'unknown'
      const title = typeof (task as any).title === 'string' ? (task as any).title : 'Untitled subtask'
      const key = `${agentId}::${title}`
      merged.set(key, { agentId, title })
    }
    for (const task of resultItems) {
      const key = `${task.agentId}::${task.title}`
      const existing = merged.get(key)
      merged.set(key, {
        ...(existing ?? { agentId: task.agentId, title: task.title }),
        ...task
      })
    }
    return [...merged.values()]
  }, [plannedTasks, resultItems])

  const allTasks = useTaskStore(s => s.tasks)
  const tasksById = useMemo(() => {
    const map = new Map<string, (typeof allTasks)[number]>()
    for (const task of allTasks) {
      map.set(task.taskId, task)
    }
    return map
  }, [allTasks])

  const title = `Create ${mergedTasks.length} subtasks`

  return (
    <Task>
      <TaskTrigger title={title}>
        <div className="flex w-full cursor-pointer items-center gap-2 text-sm transition-colors hover:text-foreground">
          <GitBranch className="h-4 w-4 text-violet-400 shrink-0" />
          <span className="flex-1 truncate">{title}</span>
          {summaryText && <span className="text-xs text-zinc-500">{summaryText}</span>}
          {!result && <span className="text-xs text-zinc-500">pending result</span>}
        </div>
      </TaskTrigger>
      <TaskContent>
        <TaskItem>
          <span className="text-xs text-zinc-500">wait mode: {waitMode}</span>
        </TaskItem>
        {mergedTasks.map((task, index) => {
          const liveTask = task.taskId ? tasksById.get(task.taskId) : undefined
          return (
            <TaskItem key={`${task.agentId}:${task.title}:${index}`}>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs">
                  <Bot size={12} />
                  <span>{task.agentId}</span>
                  <span className="text-zinc-400 truncate">{task.title}</span>
                  {liveTask?.status && <StatusBadge status={liveTask.status} />}
                  {!liveTask?.status && task.status && (
                    <span className="text-zinc-500">{task.status}</span>
                  )}
                </div>
                {(liveTask?.summary || task.summary || task.failureReason) && (
                  <div className="text-xs text-zinc-400 whitespace-pre-wrap">
                    {liveTask?.summary || task.summary || task.failureReason}
                  </div>
                )}
                {task.taskId && (
                  <Link
                    to={`/tasks/${task.taskId}`}
                    className="text-xs text-violet-400 hover:text-violet-300 inline-flex items-center gap-1"
                  >
                    View full details →
                  </Link>
                )}
              </div>
            </TaskItem>
          )
        })}
      </TaskContent>
    </Task>
  )
}

function buildAssistantRenderBlocks(parts: MessagePart[], followingToolResults: Map<string, MessagePart>): AssistantRenderBlock[] {
  const blocks: AssistantRenderBlock[] = []

  for (let index = 0; index < parts.length;) {
    const part = parts[index]!

    if (part.kind === 'text') {
      blocks.push({ kind: 'text', key: `text-${index}`, content: part.content })
      index++
      continue
    }

    if (part.kind === 'reasoning') {
      blocks.push({ kind: 'reasoning', key: `reasoning-${index}`, content: part.content })
      index++
      continue
    }

    if (part.kind === 'tool_result') {
      blocks.push({
        kind: 'tool_result',
        key: `tool-result-${index}`,
        toolName: part.toolName,
        content: part.content,
      })
      index++
      continue
    }

    const pairedResult = followingToolResults.get(part.toolCallId)
    const result = pairedResult && pairedResult.kind === 'tool_result'
      ? { content: pairedResult.content, isError: undefined }
      : undefined

    const call: ToolCallRenderModel = {
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      arguments: part.arguments,
      result
    }

    // Group only consecutive successful internal tool calls (same turn + same tool name).
    if (part.toolName !== 'createSubtasks' && isSuccessfulInternalToolCall(call)) {
      const groupedCalls: ToolCallRenderModel[] = [call]
      let cursor = index + 1

      while (cursor < parts.length) {
        const nextPart = parts[cursor]
        if (!nextPart || nextPart.kind !== 'tool_call') break
        if (nextPart.toolName !== part.toolName) break

        const nextResultPart = followingToolResults.get(nextPart.toolCallId)
        const nextResult = nextResultPart && nextResultPart.kind === 'tool_result'
          ? { content: nextResultPart.content, isError: undefined }
          : undefined
        const nextCall: ToolCallRenderModel = {
          toolCallId: nextPart.toolCallId,
          toolName: nextPart.toolName,
          arguments: nextPart.arguments,
          result: nextResult,
        }

        if (!isSuccessfulInternalToolCall(nextCall)) break

        groupedCalls.push(nextCall)
        cursor++
      }

      if (groupedCalls.length > 1) {
        blocks.push({
          kind: 'tool_call_group',
          key: `tool-group-${part.toolName}-${part.toolCallId}`,
          toolName: part.toolName,
          calls: groupedCalls,
        })
        index = cursor
        continue
      }
    }

    blocks.push({
      kind: 'tool_call_single',
      key: `tool-call-${part.toolCallId}`,
      call,
    })
    index++
  }

  return blocks
}

function ToolResultPart({ toolName, content, isError }: { toolName?: string; content: string; isError?: boolean }) {
  const errorDetected = detectToolError(content, isError)
  const state = errorDetected ? 'output-error' : 'output-available'
  const resolvedName = toolName ?? 'tool'
  const showFriendlySummary = !!toolName && isInternalTool(toolName)
  const outputSummary = showFriendlySummary ? formatToolOutputSummary(toolName, content) : null

  return (
    <Tool>
      <ToolHeader
        type="dynamic-tool"
        state={state}
        toolName={resolvedName}
        title={showFriendlySummary ? getToolDisplayName(toolName) : undefined}
      />
      <ToolContent>
        {showFriendlySummary && (
          <div className="rounded-md border border-zinc-800/80 bg-zinc-950/40 px-3 py-2">
            <p className="text-xs text-zinc-500 whitespace-pre-wrap break-words">
              {errorDetected ? 'Error' : 'Result'}: {outputSummary}
            </p>
          </div>
        )}
        <ToolOutput output={content} errorText={errorDetected ? content : undefined} />
      </ToolContent>
    </Tool>
  )
}

function AssistantPartsRenderer({ parts, followingToolResults }: {
  parts: MessagePart[]
  followingToolResults: Map<string, MessagePart>
}) {
  const blocks = useMemo(
    () => buildAssistantRenderBlocks(parts, followingToolResults),
    [parts, followingToolResults],
  )

  return (
    <div className="space-y-3">
      {blocks.map((block) => {
        switch (block.kind) {
          case 'text':
            return <TextPart key={block.key} content={block.content} />

          case 'reasoning':
            return <ReasoningPart key={block.key} content={block.content} />

          case 'tool_result':
            return <ToolResultPart key={block.key} toolName={block.toolName} content={block.content} />

          case 'tool_call_group':
            return (
              <GroupedInternalToolCallPart
                key={block.key}
                toolName={block.toolName}
                calls={block.calls}
              />
            )

          case 'tool_call_single': {
            const { call } = block
            if (call.toolName === 'createSubtasks') {
              return (
                <CreateSubtasksToolCallPart
                  key={block.key}
                  arguments={call.arguments}
                  result={call.result}
                />
              )
            }

            if (isInternalTool(call.toolName)) {
              return (
                <FriendlyInternalToolCallPart
                  key={block.key}
                  toolName={call.toolName}
                  arguments={call.arguments}
                  result={call.result}
                />
              )
            }

            return (
              <GenericToolCallPart
                key={block.key}
                toolName={call.toolName}
                arguments={call.arguments}
                result={call.result}
              />
            )
          }
        }
      })}
    </div>
  )
}

function SystemMessage({ msg }: { msg: ConversationMessage }) {
  const textPart = msg.parts.find(p => p.kind === 'text')
  if (!textPart || textPart.kind !== 'text') return null
  const [expanded, setExpanded] = useState(false)
  const content = textPart.content
  const shouldTruncate = content.length > 320
  const displayContent = expanded || !shouldTruncate
    ? content
    : `${content.slice(0, 320).trimEnd()}…`

  return (
    <div className="rounded-md border border-zinc-800/80 bg-zinc-950/40 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-zinc-500 whitespace-pre-wrap break-words">{displayContent}</p>
        <span className="shrink-0 text-[10px] text-zinc-700">{timeAgo(msg.timestamp)}</span>
      </div>
      {shouldTruncate && (
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="mt-1 text-[11px] text-zinc-400 hover:text-zinc-200"
        >
          {expanded ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  )
}

function UserMessage({ msg }: { msg: ConversationMessage }) {
  const textPart = msg.parts.find(p => p.kind === 'text')
  if (!textPart || textPart.kind !== 'text') return null

  return (
    <Message from="user">
      <div className="flex items-center gap-2 justify-end">
        <span className="text-[10px] text-zinc-600">{timeAgo(msg.timestamp)}</span>
        <div className="rounded-full bg-violet-600/20 p-1">
          <User className="h-3 w-3 text-violet-400" />
        </div>
      </div>
      <MessageContent>
        <MessageResponse>{textPart.content}</MessageResponse>
      </MessageContent>
    </Message>
  )
}

function AssistantMessage({ msg, followingToolResults }: {
  msg: ConversationMessage
  followingToolResults: Map<string, MessagePart>
}) {
  if (msg.parts.length === 0) return null

  return (
    <Message from="assistant">
      <div className="flex items-center gap-2">
        <div className="rounded-full bg-zinc-800 p-1">
          <Bot className="h-3 w-3 text-zinc-400" />
        </div>
        <span className="text-[10px] text-zinc-600">{timeAgo(msg.timestamp)}</span>
      </div>
      <MessageContent>
        <AssistantPartsRenderer parts={msg.parts} followingToolResults={followingToolResults} />
      </MessageContent>
    </Message>
  )
}

/**
 * Pair assistant tool_call parts with following tool_result messages.
 * Returns the per-assistant pairing map and a set of consumed tool message IDs.
 */
function buildToolResultPairings(messages: ConversationMessage[]) {
  const pairings = new Map<string, Map<string, MessagePart>>()
  const consumedToolMsgIds = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role !== 'assistant') continue

    const toolCallIds = msg.parts
      .filter((p): p is MessagePart & { kind: 'tool_call' } => p.kind === 'tool_call')
      .map(p => p.toolCallId)

    if (toolCallIds.length === 0) continue

    const resultMap = new Map<string, MessagePart>()

    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j]!
      if (next.role === 'tool') {
        const resultPart = next.parts.find(p => p.kind === 'tool_result')
        if (resultPart && resultPart.kind === 'tool_result' && toolCallIds.includes(resultPart.toolCallId)) {
          resultMap.set(resultPart.toolCallId, resultPart)
          consumedToolMsgIds.add(next.id)
        }
      } else if (next.role === 'assistant') {
        break
      }
    }

    pairings.set(msg.id, resultMap)
  }

  return { pairings, consumedToolMsgIds }
}

interface ConversationViewProps {
  taskId: string
  className?: string
}

export function ConversationView({ taskId, className }: ConversationViewProps) {
  const messages = useConversationStore(s => s.getMessages(taskId))
  const loading = useConversationStore(s => s.loadingTasks.has(taskId))
  const fetchConversation = useConversationStore(s => s.fetchConversation)

  useEffect(() => {
    fetchConversation(taskId)
  }, [taskId, fetchConversation])

  const { pairings, consumedToolMsgIds } = useMemo(
    () => buildToolResultPairings(messages),
    [messages],
  )

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        <p className="text-sm">Loading conversation…</p>
      </div>
    )
  }

  const isEmpty = messages.length === 0 && !loading

  return (
    <Conversation className={cn('flex flex-col', className)}>
      <ConversationContent className="gap-4 px-1 py-4">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <MessageSquare className="h-8 w-8 mb-2 text-zinc-700" />
            <p className="text-sm">No conversation yet.</p>
          </div>
        )}

        {messages.map(msg => {
          if (consumedToolMsgIds.has(msg.id)) return null

          switch (msg.role) {
            case 'system':
              return <SystemMessage key={msg.id} msg={msg} />
            case 'user':
              return <UserMessage key={msg.id} msg={msg} />
            case 'assistant':
              return (
                <AssistantMessage
                  key={msg.id}
                  msg={msg}
                  followingToolResults={pairings.get(msg.id) ?? new Map()}
                />
              )
            case 'tool':
              return (
                <div key={msg.id} className="ml-4">
                  {msg.parts.map((part, idx) => {
                    if (part.kind !== 'tool_result') return null
                    return <ToolResultPart key={idx} toolName={part.toolName} content={part.content} />
                  })}
                </div>
              )
            default:
              return null
          }
        })}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
