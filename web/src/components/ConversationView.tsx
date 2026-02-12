/**
 * ConversationView — chat-like interface for viewing task conversation history.
 *
 * Uses ai-elements Message components to render a rich conversation timeline
 * that combines stored LLM messages with live streaming output.
 * Preserves interleaved output order (reasoning → tool → reasoning → content)
 * via the `parts` array on each ConversationMessage.
 */

import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/utils'
import { useConversationStore, type ConversationMessage, type MessagePart } from '@/stores/conversationStore'
import { useStreamStore } from '@/stores/streamStore'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  Bot, User, AlertCircle, MessageSquare,
} from 'lucide-react'

// ── Message part renderers ─────────────────────────────────────────────

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

function ToolCallPart({ toolName, arguments: args }: { toolName: string; arguments: Record<string, unknown> }) {
  return (
    <Tool>
      <ToolHeader type="dynamic-tool" state="input-streaming" toolName={toolName} />
      <ToolContent>
        <ToolInput input={args} />
      </ToolContent>
    </Tool>
  )
}

function ToolResultPart({ toolName, content }: { toolName?: string; content: string }) {
  const isError = content.includes('error') || content.includes('Error') || content.includes('failed')
  const state = isError ? 'output-error' : 'output-available'
  return (
    <Tool>
      <ToolHeader type="dynamic-tool" state={state} toolName={toolName ?? 'tool'} />
      <ToolContent>
        <ToolOutput output={content} errorText={isError ? content : undefined} />
      </ToolContent>
    </Tool>
  )
}

function MessagePartRenderer({ part }: { part: MessagePart }) {
  switch (part.kind) {
    case 'text':
      return <TextPart content={part.content} />
    case 'reasoning':
      return <ReasoningPart content={part.content} />
    case 'tool_call':
      return <ToolCallPart toolName={part.toolName} arguments={part.arguments} />
    case 'tool_result':
      return <ToolResultPart toolName={part.toolName} content={part.content} />
  }
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

function AssistantMessage({ msg }: { msg: ConversationMessage }) {
  const hasContent = msg.parts.length > 0
  if (!hasContent) return null

  return (
    <Message from="assistant">
      <div className="flex items-center gap-2">
        <div className="rounded-full bg-zinc-800 p-1">
          <Bot className="h-3 w-3 text-zinc-400" />
        </div>
        <span className="text-[10px] text-zinc-600">{timeAgo(msg.timestamp)}</span>
      </div>
      <MessageContent>
        <div className="space-y-3">
          {msg.parts.map((part, idx) => (
            <MessagePartRenderer key={idx} part={part} />
          ))}
        </div>
      </MessageContent>
    </Message>
  )
}

function ToolMessage({ msg }: { msg: ConversationMessage }) {
  const toolResult = msg.parts.find(p => p.kind === 'tool_result')
  if (!toolResult || toolResult.kind !== 'tool_result') return null

  return (
    <div className="ml-4">
      <ToolResultPart
        toolName={toolResult.toolName}
        content={toolResult.content}
      />
    </div>
  )
}

function ConversationMessageItem({ msg }: { msg: ConversationMessage }) {
  switch (msg.role) {
    case 'system': return <SystemMessage msg={msg} />
    case 'user': return <UserMessage msg={msg} />
    case 'assistant': return <AssistantMessage msg={msg} />
    case 'tool': return <ToolMessage msg={msg} />
    default: return null
  }
}

// ── Live streaming section ─────────────────────────────────────────────

function LiveStream({ taskId }: { taskId: string }) {
  const stream = useStreamStore(s => s.streams[taskId])
  if (!stream || stream.chunks.length === 0) return null

  return (
    <div className="space-y-3">
      {stream.chunks.map((chunk, idx) => {
        switch (chunk.kind) {
          case 'text':
            return (
              <Message key={idx} from="assistant">
                <div className="flex items-center gap-2">
                  <div className="rounded-full bg-zinc-800 p-1">
                    <Bot className="h-3 w-3 text-zinc-400" />
                  </div>
                  {!stream.completed && <Shimmer className="h-3">thinking…</Shimmer>}
                </div>
                <MessageContent>
                  <MessageResponse>{chunk.content}</MessageResponse>
                </MessageContent>
              </Message>
            )
          case 'reasoning':
            return (
              <Reasoning key={idx} isStreaming={!stream.completed} defaultOpen>
                <ReasoningTrigger />
                <ReasoningContent>{chunk.content}</ReasoningContent>
              </Reasoning>
            )
          case 'error':
            return (
              <Message key={idx} from="assistant">
                <MessageContent>
                  <div className="rounded-md border border-red-800/40 bg-red-950/20 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                      <pre className="text-xs text-red-300 whitespace-pre-wrap">{chunk.content}</pre>
                    </div>
                  </div>
                </MessageContent>
              </Message>
            )
          case 'verbose':
            return (
              <div key={idx} className="text-xs text-zinc-500 font-mono">
                {chunk.content}
              </div>
            )
          default:
            return null
        }
      })}
    </div>
  )
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => {
    fetchConversation(taskId)
  }, [taskId, fetchConversation])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const threshold = 80
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }, [])

  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        <Shimmer className="h-4">Loading conversation…</Shimmer>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-4 overflow-y-auto px-1 py-4 min-h-0"
      >
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <MessageSquare className="h-8 w-8 mb-2 text-zinc-700" />
            <p className="text-sm">No conversation yet.</p>
          </div>
        )}

        {messages.map(msg => (
          <ConversationMessageItem key={msg.id} msg={msg} />
        ))}

        <LiveStream taskId={taskId} />
      </div>
    </div>
  )
}
