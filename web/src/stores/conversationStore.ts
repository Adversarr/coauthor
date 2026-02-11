/**
 * Conversation store — builds a structured conversation view from events.
 *
 * Fetches events for a specific task and transforms them into a linear
 * conversation timeline (messages, interactions, status changes).
 * Used by the ConversationView component (ai-elements).
 */

import { create } from 'zustand'
import { api } from '@/services/api'
import type { StoredEvent } from '@/types'
import { eventBus } from './eventBus'
import {
  TaskCreatedPayload, TaskCompletedPayload,
  TaskFailedPayload, TaskCanceledPayload,
  InteractionRequestedPayload, InteractionRespondedPayload,
  InstructionAddedPayload, safeParse,
} from '@/schemas/eventPayloads'

// ── Conversation message types ─────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageKind = 'text' | 'reasoning' | 'tool_call' | 'interaction' | 'status' | 'instruction' | 'error'

export interface ConversationMessage {
  id: string
  role: MessageRole
  kind: MessageKind
  content: string
  timestamp: string
  /** For interaction messages, the interaction metadata. */
  metadata?: Record<string, unknown>
}

const EMPTY_MESSAGES: ConversationMessage[] = []

// ── Store ──────────────────────────────────────────────────────────────

interface ConversationState {
  /** Task ID → conversation messages */
  conversations: Record<string, ConversationMessage[]>
  /** Currently loading task IDs */
  loadingTasks: Set<string>

  /** Fetch conversation history for a task from the events API. */
  fetchConversation: (taskId: string) => Promise<void>

  /** Get messages for a task. */
  getMessages: (taskId: string) => ConversationMessage[]

  /** Clear conversation for a task. */
  clearConversation: (taskId: string) => void
}

/** Transform a StoredEvent into conversation messages (B8: Zod-validated payloads). */
function eventToMessages(event: StoredEvent): ConversationMessage[] {
  const base = { timestamp: event.createdAt }

  switch (event.type) {
    case 'TaskCreated': {
      const p = safeParse(TaskCreatedPayload, event.payload, event.type)
      if (!p) return []
      return [{
        ...base,
        id: `${event.id}-created`,
        role: 'system' as const,
        kind: 'status' as const,
        content: `Task created: ${p.title}`,
        metadata: { intent: p.intent, agentId: p.agentId },
      }]
    }
    case 'TaskStarted':
      return [{ ...base, id: `${event.id}-started`, role: 'system', kind: 'status', content: 'Agent started working' }]
    case 'TaskCompleted': {
      const p = safeParse(TaskCompletedPayload, event.payload, event.type)
      if (!p) return []
      return [{ ...base, id: `${event.id}-done`, role: 'assistant', kind: 'text', content: p.summary || 'Task completed.' }]
    }
    case 'TaskFailed': {
      const p = safeParse(TaskFailedPayload, event.payload, event.type)
      if (!p) return []
      return [{ ...base, id: `${event.id}-fail`, role: 'system', kind: 'error', content: `Task failed: ${p.reason}` }]
    }
    case 'TaskCanceled': {
      const p = safeParse(TaskCanceledPayload, event.payload, event.type)
      if (!p) return []
      return [{ ...base, id: `${event.id}-cancel`, role: 'system', kind: 'status', content: `Task canceled${p.reason ? `: ${p.reason}` : ''}` }]
    }
    case 'TaskPaused':
      return [{ ...base, id: `${event.id}-pause`, role: 'system', kind: 'status', content: 'Task paused' }]
    case 'TaskResumed':
      return [{ ...base, id: `${event.id}-resume`, role: 'system', kind: 'status', content: 'Task resumed' }]
    case 'TaskInstructionAdded': {
      const p = safeParse(InstructionAddedPayload, event.payload, event.type)
      if (!p) return []
      return [{ ...base, id: `${event.id}-inst`, role: 'user', kind: 'instruction', content: p.instruction }]
    }
    case 'UserInteractionRequested': {
      const p = safeParse(InteractionRequestedPayload, event.payload, event.type)
      if (!p) return []
      return [{
        ...base,
        id: `${event.id}-req`,
        role: 'assistant',
        kind: 'interaction',
        content: p.purpose ?? '',
        metadata: { interactionId: p.interactionId, kind: p.kind },
      }]
    }
    case 'UserInteractionResponded': {
      const p = safeParse(InteractionRespondedPayload, event.payload, event.type)
      if (!p) return []
      return [{
        ...base,
        id: `${event.id}-resp`,
        role: 'user',
        kind: 'interaction',
        content: p.inputValue || p.selectedOptionId || 'Response submitted',
        metadata: { interactionId: p.interactionId },
      }]
    }
    default:
      return []
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
      const events = await api.getEvents(0, taskId)
      const messages = events.flatMap(eventToMessages)
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

// Subscribe to real-time events — append to existing conversation
eventBus.on('domain-event', (event) => {
  const taskId = (event.payload as Record<string, unknown>).taskId as string | undefined
  if (!taskId) return

  const newMessages = eventToMessages(event)
  if (newMessages.length === 0) return

  useConversationStore.setState((state) => {
    // Only append if we already have a conversation loaded for this task.
    const existing = state.conversations[taskId]
    if (!existing) return state

    // Deduplicate by id.
    const existingIds = new Set(existing.map(m => m.id))
    const unique = newMessages.filter(m => !existingIds.has(m.id))
    if (unique.length === 0) return state

    return {
      conversations: { ...state.conversations, [taskId]: [...existing, ...unique] },
    }
  })
})
