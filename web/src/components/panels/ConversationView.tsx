/**
 * ConversationView — rich chat interface for task conversation history + live streaming.
 *
 * Renders stored LLM messages with true interleaved parts ordering, plus live streaming
 * output including real-time tool call/result display. Uses the Conversation ai-element
 * for reliable auto-scroll (StickToBottom pattern).
 *
 * Supports:
 * - Interleaved text/reasoning/tool_call parts in any order
 * - Real-time tool call streaming (tool_call_start/end)
 * - Paired tool call + result rendering
 * - Subtask tool calls rendered as inline cards
 * - Improved error detection for tool results
 */

import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/utils'
import { useConversationStore, type ConversationMessage, type MessagePart } from '@/stores/conversationStore'
import { useStreamStore, type StreamChunk } from '@/stores/streamStore'
import { useTaskStore } from '@/stores/taskStore'
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Task, TaskTrigger, TaskContent, TaskItem } from '@/components/ai-elements/task'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { StatusBadge } from '@/components/display/StatusBadge'
import {
  Bot, User, AlertCircle, MessageSquare, GitBranch, Clock,
} from 'lucide-react'

// ── Error detection ────────────────────────────────────────────────────

/** Smarter error detection that avoids false positives like "No errors found" */
function detectToolError(content: string, isError?: boolean): boolean {
  // Explicit isError flag takes precedence
  if (typeof isError === 'boolean') return isError
  // Try to parse JSON and check for isError/error fields
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === 'object' && parsed !== null) {
      if ('isError' in parsed && parsed.isError === true) return true
      if ('error' in parsed && typeof parsed.error === 'string' && parsed.error.length > 0) return true
    }
    return false
  } catch {
    // Not JSON — fall back to pattern matching, but be conservative
    const lower = content.toLowerCase()
    // Only flag as error if it starts with error-indicating patterns
    return /^(error:|fatal:|exception:|failed to |cannot |unable to )/i.test(content.trim())
      || (lower.includes('"error"') && lower.includes('true'))
  }
}

/** Check if a tool call is a subtask creation call */
function isSubtaskToolCall(toolName: string): boolean {
  return toolName.startsWith('create_subtask_')
}

// ── Message part renderers ─────────────────────────────────────────────

function TextPart({ content }: { content: string }) {
  return <MessageResponse>{content}</MessageResponse>
}

function ReasoningPart({ content, defaultOpen = false, isStreaming = false }: { content: string; defaultOpen?: boolean; isStreaming?: boolean }) {
  return (
    <Reasoning defaultOpen={defaultOpen} isStreaming={isStreaming}>
      <ReasoningTrigger />
      <ReasoningContent>{content}</ReasoningContent>
    </Reasoning>
  )
}

function ToolCallPart({ toolName, arguments: args, result }: {
  toolName: string
  arguments: Record<string, unknown>
  result?: { content: string; isError?: boolean }
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

function SubtaskToolCallPart({ toolName, arguments: args, result }: {
  toolName: string
  arguments: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}) {
  const agentId = toolName.replace('create_subtask_', '')
  const taskTitle = (args.title as string) || (args.intent as string) || `Subtask (${agentId})`

  // Try to find the child task in the store for live status
  let childTaskId: string | undefined
  let childStatus: string | undefined
  let childSummary: string | undefined

  if (result) {
    try {
      const parsed = JSON.parse(result.content)
      if (typeof parsed?.taskId === 'string') childTaskId = parsed.taskId
      if (typeof parsed?.subTaskStatus === 'string') childStatus = parsed.subTaskStatus
      const summary = parsed?.summary || parsed?.finalAssistantMessage
      if (typeof summary === 'string') childSummary = summary
    } catch { /* not JSON */ }
  }

  const childTask = useTaskStore(s =>
    childTaskId ? s.tasks.find(t => t.taskId === childTaskId) : undefined
  )

  const displayStatus = childTask?.status
  const displaySummary = childTask?.summary || childSummary

  return (
    <Task>
      <TaskTrigger title={taskTitle}>
        <div className="flex w-full cursor-pointer items-center gap-2 text-sm transition-colors hover:text-foreground">
          <GitBranch className="h-4 w-4 text-violet-400 shrink-0" />
          <span className="flex-1 truncate">{taskTitle}</span>
          {displayStatus && <StatusBadge status={displayStatus} />}
          {!result && <Shimmer className="h-3">running…</Shimmer>}
          {childStatus === 'Error' && (
            <span className="text-xs text-red-400">Failed</span>
          )}
        </div>
      </TaskTrigger>
      <TaskContent>
        {(args.intent || args.goal) ? (
          <TaskItem>{String(args.intent || args.goal)}</TaskItem>
        ) : null}
        <TaskItem>
          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
            <Bot size={12} /> Agent: {agentId}
          </span>
        </TaskItem>
        {displaySummary && (
          <TaskItem>
            <div className="text-xs text-zinc-400 mt-1 whitespace-pre-wrap">{displaySummary}</div>
          </TaskItem>
        )}
        {childTaskId && (
          <TaskItem>
            <Link
              to={`/tasks/${childTaskId}`}
              className="text-xs text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 mt-1"
            >
              View full details →
            </Link>
          </TaskItem>
        )}
      </TaskContent>
    </Task>
  )
}

function ToolResultPart({ toolName, content, isError }: { toolName?: string; content: string; isError?: boolean }) {
  const errorDetected = detectToolError(content, isError)
  const state = errorDetected ? 'output-error' : 'output-available'
  return (
    <Tool>
      <ToolHeader type="dynamic-tool" state={state} toolName={toolName ?? 'tool'} />
      <ToolContent>
        <ToolOutput output={content} errorText={errorDetected ? content : undefined} />
      </ToolContent>
    </Tool>
  )
}

// ── Paired message rendering (group tool_call + tool_result) ───────────

/**
 * Given an assistant message's parts and the subsequent tool messages,
 * pairs tool_call parts with their matching tool_result for unified display.
 */
function AssistantPartsRenderer({ parts, followingToolResults }: {
  parts: MessagePart[]
  followingToolResults: Map<string, MessagePart>
}) {
  return (
    <div className="space-y-3">
      {parts.map((part, idx) => {
        switch (part.kind) {
          case 'text':
            return <TextPart key={idx} content={part.content} />
          case 'reasoning':
            return <ReasoningPart key={idx} content={part.content} />
          case 'tool_call': {
            const result = followingToolResults.get(part.toolCallId)
            const resultData = result && result.kind === 'tool_result'
              ? { content: result.content, isError: undefined }
              : undefined

            if (isSubtaskToolCall(part.toolName)) {
              return (
                <SubtaskToolCallPart
                  key={idx}
                  toolName={part.toolName}
                  arguments={part.arguments}
                  result={resultData}
                />
              )
            }

            return (
              <ToolCallPart
                key={idx}
                toolName={part.toolName}
                arguments={part.arguments}
                result={resultData}
              />
            )
          }
          case 'tool_result':
            // Standalone tool results (not paired with an assistant tool_call)
            return <ToolResultPart key={idx} toolName={part.toolName} content={part.content} />
        }
      })}
    </div>
  )
}

// ── Message renderers ──────────────────────────────────────────────────

function SystemMessage({ msg }: { msg: ConversationMessage }) {
  const textPart = msg.parts.find(p => p.kind === 'text')
  if (!textPart || textPart.kind !== 'text') return null

  return (
    <div className="flex items-center justify-center gap-2 py-1.5">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <span>{textPart.content}</span>
      </div>
      <span className="text-[10px] text-zinc-700">{timeAgo(msg.timestamp)}</span>
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

// ── Message grouping logic ─────────────────────────────────────────────

/**
 * Pre-process messages to pair assistant tool_call parts with their following tool messages.
 * Returns a map of toolCallId → tool_result MessagePart for each assistant message,
 * and a set of tool message IDs that have been consumed (so they won't render standalone).
 */
function buildToolResultPairings(messages: ConversationMessage[]) {
  const pairings = new Map<string, Map<string, MessagePart>>() // msgId → (toolCallId → result part)
  const consumedToolMsgIds = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role !== 'assistant') continue

    const toolCallIds = msg.parts
      .filter((p): p is MessagePart & { kind: 'tool_call' } => p.kind === 'tool_call')
      .map(p => p.toolCallId)

    if (toolCallIds.length === 0) continue

    const resultMap = new Map<string, MessagePart>()

    // Scan following messages for matching tool results
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j]!
      if (next.role === 'tool') {
        const resultPart = next.parts.find(p => p.kind === 'tool_result')
        if (resultPart && resultPart.kind === 'tool_result' && toolCallIds.includes(resultPart.toolCallId)) {
          resultMap.set(resultPart.toolCallId, resultPart)
          consumedToolMsgIds.add(next.id)
        }
      } else if (next.role === 'assistant') {
        break // Stop scanning at the next assistant message
      }
    }

    pairings.set(msg.id, resultMap)
  }

  return { pairings, consumedToolMsgIds }
}

// ── Live streaming section ─────────────────────────────────────────────

function LiveStream({ taskId }: { taskId: string }) {
  const stream = useStreamStore(s => s.streams[taskId])
  if (!stream || stream.chunks.length === 0) return null

  // Group consecutive text/reasoning/tool chunks under one assistant "message"
  const groups = groupStreamChunks(stream.chunks)

  return (
    <>
      {groups.map((group, gIdx) => {
        if (group.type === 'assistant') {
          return (
            <Message key={`stream-g-${gIdx}`} from="assistant">
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-zinc-800 p-1">
                  <Bot className="h-3 w-3 text-zinc-400" />
                </div>
                {!stream.completed && gIdx === groups.length - 1 && (
                  <Shimmer className="h-3">thinking…</Shimmer>
                )}
              </div>
              <MessageContent>
                <div className="space-y-3">
                  {group.chunks.map((chunk, idx) => (
                    <StreamChunkRenderer
                      key={`${gIdx}-${idx}`}
                      chunk={chunk}
                      isStreaming={!stream.completed}
                      allChunks={stream.chunks}
                    />
                  ))}
                </div>
              </MessageContent>
            </Message>
          )
        }

        // Standalone error / verbose
        return group.chunks.map((chunk, idx) => (
          <StreamChunkRenderer
            key={`stream-s-${gIdx}-${idx}`}
            chunk={chunk}
            isStreaming={!stream.completed}
            allChunks={stream.chunks}
          />
        ))
      })}
    </>
  )
}

interface ChunkGroup {
  type: 'assistant' | 'standalone'
  chunks: StreamChunk[]
}

/** Group stream chunks into logical message groups */
function groupStreamChunks(chunks: StreamChunk[]): ChunkGroup[] {
  const groups: ChunkGroup[] = []
  let currentGroup: ChunkGroup | null = null

  for (const chunk of chunks) {
    if (chunk.kind === 'text' || chunk.kind === 'reasoning' || chunk.kind === 'tool_call' || chunk.kind === 'tool_result') {
      if (!currentGroup || currentGroup.type !== 'assistant') {
        currentGroup = { type: 'assistant', chunks: [] }
        groups.push(currentGroup)
      }
      currentGroup.chunks.push(chunk)
    } else {
      // error, verbose — standalone
      currentGroup = { type: 'standalone', chunks: [chunk] }
      groups.push(currentGroup)
      currentGroup = null
    }
  }

  return groups
}

function StreamChunkRenderer({ chunk, isStreaming, allChunks }: {
  chunk: StreamChunk
  isStreaming: boolean
  allChunks: StreamChunk[]
}) {
  switch (chunk.kind) {
    case 'text':
      return <MessageResponse>{chunk.content}</MessageResponse>

    case 'reasoning':
      return (
        <Reasoning isStreaming={isStreaming} defaultOpen>
          <ReasoningTrigger />
          <ReasoningContent>{chunk.content}</ReasoningContent>
        </Reasoning>
      )

    case 'tool_call': {
      // Find matching tool_result in the stream
      const result = allChunks.find(
        c => c.kind === 'tool_result' && c.toolCallId === chunk.toolCallId
      )
      const hasResult = !!result
      const isError = result ? detectToolError(result.content, result.isError) : false
      const state = hasResult
        ? (isError ? 'output-error' : 'output-available')
        : 'input-available'

      if (chunk.toolName && isSubtaskToolCall(chunk.toolName)) {
        return (
          <SubtaskToolCallPart
            toolName={chunk.toolName}
            arguments={chunk.toolArguments ?? {}}
            result={result ? { content: result.content, isError: result.isError } : undefined}
          />
        )
      }

      return (
        <Tool>
          <ToolHeader type="dynamic-tool" state={state} toolName={chunk.toolName ?? 'tool'} />
          <ToolContent>
            {chunk.toolArguments && <ToolInput input={chunk.toolArguments} />}
            {!hasResult && isStreaming && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Clock className="h-3 w-3 animate-pulse" />
                <Shimmer className="h-3">executing…</Shimmer>
              </div>
            )}
            {result && (
              <ToolOutput
                output={result.content}
                errorText={isError ? result.content : undefined}
              />
            )}
          </ToolContent>
        </Tool>
      )
    }

    case 'tool_result': {
      // Only render standalone if there's no matching tool_call in the stream
      const hasMatchingCall = allChunks.some(
        c => c.kind === 'tool_call' && c.toolCallId === chunk.toolCallId
      )
      if (hasMatchingCall) return null // Already rendered as part of tool_call

      return (
        <ToolResultPart
          toolName={chunk.toolName}
          content={chunk.content}
          isError={chunk.isError}
        />
      )
    }

    case 'error':
      return (
        <div className="rounded-md border border-red-800/40 bg-red-950/20 px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <pre className="text-xs text-red-300 whitespace-pre-wrap">{chunk.content}</pre>
          </div>
        </div>
      )

    case 'verbose':
      return (
        <div className="text-xs text-zinc-500 font-mono px-1">
          {chunk.content}
        </div>
      )

    default:
      return null
  }
}

// ── Main component ─────────────────────────────────────────────────────

interface ConversationViewProps {
  taskId: string
  className?: string
}

export function ConversationView({ taskId, className }: ConversationViewProps) {
  const messages = useConversationStore(s => s.getMessages(taskId))
  const loading = useConversationStore(s => s.loadingTasks.has(taskId))
  const fetchConversation = useConversationStore(s => s.fetchConversation)
  const stream = useStreamStore(s => s.streams[taskId])
  const hasStreamChunks = stream ? stream.chunks.length > 0 : false

  useEffect(() => {
    fetchConversation(taskId)
  }, [taskId, fetchConversation])

  // Pre-compute tool result pairings for efficient rendering
  const { pairings, consumedToolMsgIds } = useMemo(
    () => buildToolResultPairings(messages),
    [messages],
  )

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        <Shimmer className="h-4">Loading conversation…</Shimmer>
      </div>
    )
  }

  const isEmpty = messages.length === 0 && !hasStreamChunks && !loading

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
          // Skip tool messages that have been consumed by pairing
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
              // Remaining unpaired tool messages
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

        <LiveStream taskId={taskId} />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
