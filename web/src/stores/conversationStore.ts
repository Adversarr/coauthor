/**
 * Conversation store — builds a structured conversation view from LLM messages.
 *
 * Fetches LLM conversation history per task from the backend ConversationStore.
 * Preserves interleaved output order (reasoning → tool → reasoning → content)
 * via a `parts` array on each message.
 */

import { create } from 'zustand'
import { api } from '@/services/api'
import type { LLMMessage } from '@/types'
import { eventBus } from './eventBus'

// ── Conversation message types (preserve interleaved order) ────────────

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type MessagePart =
  | { kind: 'text'; content: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'tool_call'; toolCallId: string; toolName: string; arguments: Record<string, unknown> }
  | { kind: 'tool_result'; toolCallId: string; toolName?: string; content: string }

export interface ConversationMessage {
  id: string
  role: MessageRole
  parts: MessagePart[]
  timestamp: string
}

const EMPTY_MESSAGES: ConversationMessage[] = []

// ── Store ──────────────────────────────────────────────────────────────

interface ConversationState {
  /** Task ID → conversation messages */
  conversations: Record<string, ConversationMessage[]>
  /** Currently loading task IDs */
  loadingTasks: Set<string>

  /** Fetch conversation history for a task from the conversation API. */
  fetchConversation: (taskId: string) => Promise<void>

  /** Get messages for a task. */
  getMessages: (taskId: string) => ConversationMessage[]

  /** Clear conversation for a task. */
  clearConversation: (taskId: string) => void
}

let messageIndex = 0

function generateMessageId(): string {
  return `msg-${Date.now()}-${++messageIndex}`
}

function transformLLMMessage(message: LLMMessage): ConversationMessage {
  const timestamp = new Date().toISOString()
  const id = generateMessageId()

  switch (message.role) {
    case 'system':
      return {
        id,
        role: 'system',
        parts: [{ kind: 'text', content: message.content }],
        timestamp,
      }

    case 'user':
      return {
        id,
        role: 'user',
        parts: [{ kind: 'text', content: message.content }],
        timestamp,
      }

    case 'assistant': {
      const parts: MessagePart[] = []

      if (message.reasoning) {
        parts.push({ kind: 'reasoning', content: message.reasoning })
      }

      if (message.toolCalls && message.toolCalls.length > 0) {
        for (const toolCall of message.toolCalls) {
          parts.push({
            kind: 'tool_call',
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            arguments: toolCall.arguments,
          })
        }
      }

      if (message.content) {
        parts.push({ kind: 'text', content: message.content })
      }

      return { id, role: 'assistant', parts, timestamp }
    }

    case 'tool':
      return {
        id,
        role: 'tool',
        parts: [{
          kind: 'tool_result',
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          content: message.content,
        }],
        timestamp,
      }
  }
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: {},
  loadingTasks: new Set(),

  fetchConversation: async (taskId) => {
    const loading = new Set(get().loadingTasks)
    loading.add(taskId)
    set({ loadingTasks: loading })

    try {
      const llmMessages = await api.getConversation(taskId)
      const messages = llmMessages.map(transformLLMMessage)
      const conversations = { ...get().conversations, [taskId]: messages }
      const done = new Set(get().loadingTasks)
      done.delete(taskId)
      set({ conversations, loadingTasks: done })
    } catch {
      const done = new Set(get().loadingTasks)
      done.delete(taskId)
      set({ loadingTasks: done })
    }
  },

  getMessages: (taskId) => get().conversations[taskId] ?? EMPTY_MESSAGES,

  clearConversation: (taskId) => {
    const conversations = { ...get().conversations }
    delete conversations[taskId]
    set({ conversations })
  },
}))

let conversationUnsub: (() => void) | null = null

export function registerConversationSubscriptions(): void {
  if (conversationUnsub) return
  conversationUnsub = eventBus.on('domain-event', (event) => {
    const taskId = (event.payload as Record<string, unknown>).taskId as string | undefined
    if (!taskId) return

    if (event.type === 'TaskInstructionAdded') {
      const instruction = (event.payload as Record<string, unknown>).instruction as string | undefined
      if (!instruction) return

      useConversationStore.setState((state) => {
        const existing = state.conversations[taskId]
        if (!existing) return state

        const newMessage: ConversationMessage = {
          id: generateMessageId(),
          role: 'user',
          parts: [{ kind: 'text', content: instruction }],
          timestamp: event.createdAt,
        }

        return {
          conversations: { ...state.conversations, [taskId]: [...existing, newMessage] },
        }
      })
    }

    if (event.type === 'TaskCompleted' || event.type === 'TaskFailed') {
      void useConversationStore.getState().fetchConversation(taskId)
    }
  })
}

export function unregisterConversationSubscriptions(): void {
  if (conversationUnsub) {
    conversationUnsub()
    conversationUnsub = null
  }
}

registerConversationSubscriptions()
