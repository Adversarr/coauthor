/**
 * Stream store — accumulates real-time streaming output per task.
 *
 * Subscribes to eventBus for real-time updates (decoupled from connectionStore).
 * Marks streams as completed on stream_end instead of deleting them,
 * so users can still review output after the agent finishes.
 *
 * Supports text, reasoning, verbose, error, tool_call, and tool_result chunk kinds.
 */

import { create } from 'zustand'
import type { UiEvent } from '@/types'
import { eventBus } from './eventBus'
import {
  StreamPayload, StreamEndPayload,
  ToolCallStartPayload, ToolCallEndPayload,
  safeParse,
} from '@/schemas/eventPayloads'

export interface StreamChunk {
  kind: 'text' | 'reasoning' | 'verbose' | 'error' | 'tool_call' | 'tool_result'
  content: string
  timestamp: number
  /** Present on tool_call and tool_result chunks */
  toolCallId?: string
  toolName?: string
  toolArguments?: Record<string, unknown>
  toolOutput?: unknown
  isError?: boolean
  durationMs?: number
}

interface TaskStream {
  chunks: StreamChunk[]
  /** Whether the agent has finished streaming for this task. */
  completed: boolean
}

interface StreamState {
  /** Task ID → stream data */
  streams: Record<string, TaskStream>

  /** Handle incoming UiEvent from WebSocket */
  handleUiEvent: (event: UiEvent) => void

  /** Clear stream data for a task */
  clearStream: (taskId: string) => void
}

/** Max chunks per task stream to prevent unbounded memory growth. */
const MAX_STREAM_CHUNKS = 5000

function clampChunks(chunks: StreamChunk[]): StreamChunk[] {
  return chunks.length > MAX_STREAM_CHUNKS ? chunks.slice(-MAX_STREAM_CHUNKS) : chunks
}

export const useStreamStore = create<StreamState>((set) => ({
  streams: {},

  handleUiEvent: (event) => {
    if (event.type === 'agent_output' || event.type === 'stream_delta') {
      const p = safeParse(StreamPayload, event.payload, event.type)
      if (!p) return
      const { taskId, kind, content } = p
      set(state => {
        const existing = state.streams[taskId] ?? { chunks: [], completed: false }
        const chunks = [...existing.chunks]

        if (event.type === 'stream_delta' && chunks.length > 0) {
          const last = chunks[chunks.length - 1]!
          if (last.kind === kind) {
            chunks[chunks.length - 1] = { ...last, content: last.content + content }
          } else {
            chunks.push({ kind, content, timestamp: Date.now() })
          }
        } else {
          chunks.push({ kind, content, timestamp: Date.now() })
        }

        return {
          streams: {
            ...state.streams,
            [taskId]: { chunks: clampChunks(chunks), completed: false },
          },
        }
      })
    }

    if (event.type === 'tool_call_start') {
      const p = safeParse(ToolCallStartPayload, event.payload, event.type)
      if (!p) return
      set(state => {
        const existing = state.streams[p.taskId] ?? { chunks: [], completed: false }
        const chunk: StreamChunk = {
          kind: 'tool_call',
          content: `Running ${p.toolName}…`,
          timestamp: Date.now(),
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          toolArguments: p.arguments,
        }
        return {
          streams: {
            ...state.streams,
            [p.taskId]: { chunks: clampChunks([...existing.chunks, chunk]), completed: false },
          },
        }
      })
    }

    if (event.type === 'tool_call_end') {
      const p = safeParse(ToolCallEndPayload, event.payload, event.type)
      if (!p) return
      set(state => {
        const existing = state.streams[p.taskId] ?? { chunks: [], completed: false }
        const chunk: StreamChunk = {
          kind: 'tool_result',
          content: typeof p.output === 'string' ? p.output : JSON.stringify(p.output, null, 2),
          timestamp: Date.now(),
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          toolOutput: p.output,
          isError: p.isError,
          durationMs: p.durationMs,
        }
        return {
          streams: {
            ...state.streams,
            [p.taskId]: { chunks: clampChunks([...existing.chunks, chunk]), completed: false },
          },
        }
      })
    }

    if (event.type === 'stream_end') {
      const p = safeParse(StreamEndPayload, event.payload, event.type)
      if (!p) return
      set(state => {
        const existing = state.streams[p.taskId]
        if (!existing) return state
        return {
          streams: {
            ...state.streams,
            [p.taskId]: { ...existing, completed: true },
          },
        }
      })
    }
  },

  clearStream: (taskId) => {
    set(state => {
      const streams = { ...state.streams }
      delete streams[taskId]
      return { streams }
    })
  },
}))

let streamStoreUnsub: (() => void) | null = null

export function registerStreamStoreSubscriptions(): void {
  if (streamStoreUnsub) return
  streamStoreUnsub = eventBus.on('ui-event', (event) => {
    useStreamStore.getState().handleUiEvent(event)
  })
}

export function unregisterStreamStoreSubscriptions(): void {
  if (streamStoreUnsub) {
    streamStoreUnsub()
    streamStoreUnsub = null
  }
}

registerStreamStoreSubscriptions()
