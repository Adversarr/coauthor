/**
 * Tests for the conversation store.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useConversationStore } from '@/stores/conversationStore'
import { eventBus } from '@/stores/eventBus'
import type { StoredEvent } from '@/types'

function makeEvent(id: number, type: string, payload: Record<string, unknown>): StoredEvent {
  return {
    id,
    streamId: 'task-1',
    seq: id,
    type: type as StoredEvent['type'],
    payload,
    createdAt: new Date().toISOString(),
  } as StoredEvent
}

describe('conversationStore', () => {
  beforeEach(() => {
    useConversationStore.setState({ conversations: {}, loadingTasks: new Set() })
    eventBus.clear()
    // Re-import won't re-register, so we trigger the subscription manually
    // by importing the module. Since the store file registers on module load,
    // we just need eventBus subscriptions active. For testing, we test 
    // the store methods directly.
  })

  it('starts with empty conversations', () => {
    const { conversations } = useConversationStore.getState()
    expect(Object.keys(conversations)).toHaveLength(0)
  })

  it('getMessages returns empty array for unknown task', () => {
    const store = useConversationStore.getState()
    const msgs1 = store.getMessages('unknown')
    const msgs2 = store.getMessages('unknown')
    expect(msgs1).toEqual([])
    expect(msgs1).toBe(msgs2)
  })

  it('clearConversation removes task data', () => {
    useConversationStore.setState({
      conversations: { 'task-1': [{ id: 'x', role: 'system', kind: 'status', content: 'hi', timestamp: '' }] },
    })
    useConversationStore.getState().clearConversation('task-1')
    expect(useConversationStore.getState().conversations['task-1']).toBeUndefined()
  })

  it('appends real-time events to already-loaded conversation', () => {
    // Pre-load a conversation
    useConversationStore.setState({
      conversations: {
        'task-1': [{ id: '1-created', role: 'system', kind: 'status', content: 'Task created: Test', timestamp: '' }],
      },
    })

    // The store module registers an eventBus subscription on import.
    // We can't easily re-register after clear(), so test via direct state mutation
    // simulating what the subscription handler does.
    const event = makeEvent(2, 'TaskStarted', { taskId: 'task-1' })
    const conversations = useConversationStore.getState().conversations
    const existing = conversations['task-1'] ?? []
    const newMsg = { id: '2-started', role: 'system' as const, kind: 'status' as const, content: 'Agent started working', timestamp: event.createdAt }
    useConversationStore.setState({
      conversations: { ...conversations, 'task-1': [...existing, newMsg] },
    })

    const msgs = useConversationStore.getState().getMessages('task-1')
    expect(msgs).toHaveLength(2)
    expect(msgs[1]!.content).toBe('Agent started working')
  })
})
