/**
 * StreamOutput — renders live agent streaming output for a task.
 *
 * Uses ai-elements Reasoning, Message, and Tool components for rich output.
 * Falls back to raw terminal view when there's only verbose/error content.
 * Now supports tool_call/tool_result stream chunks.
 */

import { useMemo } from 'react'
import { useStreamStore, type StreamChunk } from '@/stores/streamStore'
import { Terminal, TerminalContent, TerminalHeader, TerminalTitle } from '@/components/ai-elements/terminal'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Bot, Clock } from 'lucide-react'

function chunkToAnsi(chunk: StreamChunk): string {
  switch (chunk.kind) {
    case 'error':
      return `\u001b[31m${chunk.content}\u001b[0m`
    case 'reasoning':
      return `\u001b[2m${chunk.content}\u001b[0m`
    case 'verbose':
      return `\u001b[2m${chunk.content}\u001b[0m`
    case 'text':
      return chunk.content
    default:
      return ''
  }
}

export function StreamOutput({ taskId }: { taskId: string }) {
  const stream = useStreamStore(s => s.streams[taskId])
  const clearStream = useStreamStore(s => s.clearStream)

  const chunks = stream?.chunks ?? []
  const isStreaming = stream ? !stream.completed : false

  const textContent = useMemo(() => chunks.filter(c => c.kind === 'text').map(c => c.content).join(''), [chunks])
  const reasoningContent = useMemo(() => chunks.filter(c => c.kind === 'reasoning').map(c => c.content).join(''), [chunks])
  const verboseContent = useMemo(() => chunks.filter(c => c.kind === 'verbose' || c.kind === 'error').map(chunkToAnsi).join(''), [chunks])

  // Collect tool calls and pair with results
  const toolPairs = useMemo(() => {
    const calls = chunks.filter((c): c is StreamChunk & { kind: 'tool_call' } => c.kind === 'tool_call')
    return calls.map(call => {
      const result = chunks.find(
        c => c.kind === 'tool_result' && c.toolCallId === call.toolCallId
      )
      return { call, result: result?.kind === 'tool_result' ? result : undefined }
    })
  }, [chunks])

  // Standalone tool results (no matching call)
  const standaloneResults = useMemo(() => {
    const callIds = new Set(chunks.filter(c => c.kind === 'tool_call').map(c => c.toolCallId))
    return chunks.filter(
      (c): c is StreamChunk & { kind: 'tool_result' } =>
        c.kind === 'tool_result' && !callIds.has(c.toolCallId)
    )
  }, [chunks])

  if (chunks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-600">
        <p className="text-sm">No output yet. Waiting for agent…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Reasoning section */}
      {reasoningContent && (
        <Reasoning isStreaming={isStreaming} defaultOpen>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      )}

      {/* Main text output as markdown */}
      {textContent && (
        <Message from="assistant">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-zinc-800 p-1">
              <Bot className="h-3 w-3 text-zinc-400" />
            </div>
            {isStreaming && <Shimmer className="h-3">generating…</Shimmer>}
            {stream?.completed && <span className="text-[10px] text-zinc-600">completed</span>}
          </div>
          <MessageContent>
            <MessageResponse>{textContent}</MessageResponse>
          </MessageContent>
        </Message>
      )}

      {/* Tool calls with paired results */}
      {toolPairs.map(({ call, result }, idx) => {
        const isError = result?.isError ?? false
        const state = result
          ? (isError ? 'output-error' : 'output-available')
          : 'input-available'

        return (
          <Tool key={`tool-${call.toolCallId ?? idx}`}>
            <ToolHeader type="dynamic-tool" state={state} toolName={call.toolName ?? 'tool'} />
            <ToolContent>
              {call.toolArguments && <ToolInput input={call.toolArguments} />}
              {!result && isStreaming && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Clock className="h-3 w-3 animate-pulse" />
                  <Shimmer className="h-3">executing…</Shimmer>
                </div>
              )}
              {result && (
                <ToolOutput output={result.content} errorText={isError ? result.content : undefined} />
              )}
            </ToolContent>
          </Tool>
        )
      })}

      {/* Standalone tool results */}
      {standaloneResults.map((chunk, idx) => (
        <Tool key={`result-${chunk.toolCallId ?? idx}`}>
          <ToolHeader
            type="dynamic-tool"
            state={chunk.isError ? 'output-error' : 'output-available'}
            toolName={chunk.toolName ?? 'tool'}
          />
          <ToolContent>
            <ToolOutput
              output={chunk.content}
              errorText={chunk.isError ? chunk.content : undefined}
            />
          </ToolContent>
        </Tool>
      ))}

      {/* Verbose/error as raw terminal */}
      {verboseContent && (
        <Terminal output={verboseContent} onClear={() => clearStream(taskId)} className="border-border bg-zinc-950">
          <TerminalHeader>
            <TerminalTitle>Raw Output</TerminalTitle>
          </TerminalHeader>
          <TerminalContent />
        </Terminal>
      )}
    </div>
  )
}
