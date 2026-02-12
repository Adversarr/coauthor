/**
 * Tests for the conversation store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useConversationStore, registerConversationSubscriptions, unregisterConversationSubscriptions } from '@/stores/conversationStore'
import { eventBus } from '@/stores/eventBus'
import type { StoredEvent } from '@/types'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  api: {
    getConversation: vi.fn(),
  },
}))

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
    unregisterConversationSubscriptions()
    eventBus.clear()
    registerConversationSubscriptions()
    vi.clearAllMocks()
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
      conversations: {
        'task-1': [{
          id: 'x',
          role: 'system',
          parts: [{ kind: 'text', content: 'hi' }],
          timestamp: '',
        }],
      },
    })
    useConversationStore.getState().clearConversation('task-1')
    expect(useConversationStore.getState().conversations['task-1']).toBeUndefined()
  })

  it('fetches conversation from API and transforms messages', async () => {
    const mockMessages = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!', toolCalls: [], reasoning: '' },
    ]
    vi.mocked(api.api.getConversation).mockResolvedValue(mockMessages)

    const store = useConversationStore.getState()
    await store.fetchConversation('task-1')

    const msgs = store.getMessages('task-1')
    expect(msgs).toHaveLength(3)
    expect(msgs[0]!.role).toBe('system')
    expect(msgs[0]!.parts[0]).toEqual({ kind: 'text', content: 'You are a helpful assistant.' })
    expect(msgs[1]!.role).toBe('user')
    expect(msgs[1]!.parts[0]).toEqual({ kind: 'text', content: 'Hello' })
    expect(msgs[2]!.role).toBe('assistant')
  })

  it('transforms assistant messages with tool calls', async () => {
    const mockMessages = [
      {
        role: 'assistant' as const,
        content: 'Result',
        toolCalls: [
          { toolCallId: 'tc-1', toolName: 'readFile', arguments: { path: '/test.txt' } },
        ],
        reasoning: 'Thinking...',
      },
    ]
    vi.mocked(api.api.getConversation).mockResolvedValue(mockMessages)

    const store = useConversationStore.getState()
    await store.fetchConversation('task-1')

    const msgs = store.getMessages('task-1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.parts).toHaveLength(3)
    expect(msgs[0]!.parts[0]).toEqual({ kind: 'reasoning', content: 'Thinking...' })
    expect(msgs[0]!.parts[1]).toEqual({
      kind: 'tool_call',
      toolCallId: 'tc-1',
      toolName: 'readFile',
      arguments: { path: '/test.txt' },
    })
    expect(msgs[0]!.parts[2]).toEqual({ kind: 'text', content: 'Result' })
  })

  it('transforms tool result messages', async () => {
    const mockMessages = [
      { role: 'tool' as const, toolCallId: 'tc-1', toolName: 'readFile', content: 'file contents' },
    ]
    vi.mocked(api.api.getConversation).mockResolvedValue(mockMessages)

    const store = useConversationStore.getState()
    await store.fetchConversation('task-1')

    const msgs = store.getMessages('task-1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.role).toBe('tool')
    expect(msgs[0]!.parts[0]).toEqual({
      kind: 'tool_result',
      toolCallId: 'tc-1',
      toolName: 'readFile',
      content: 'file contents',
    })
  })

  it('appends user instruction via TaskInstructionAdded event', () => {
    useConversationStore.setState({
      conversations: {
        'task-1': [{
          id: '1-created',
          role: 'system',
          parts: [{ kind: 'text', content: 'Task created: Test' }],
          timestamp: '',
        }],
      },
    })

    const event = makeEvent(2, 'TaskInstructionAdded', { taskId: 'task-1', instruction: 'Please help me' })
    eventBus.emit('domain-event', event)

    const msgs = useConversationStore.getState().getMessages('task-1')
    expect(msgs).toHaveLength(2)
    expect(msgs[1]!.role).toBe('user')
    expect(msgs[1]!.parts[0]).toEqual({ kind: 'text', content: 'Please help me' })
  })

  it('ignores events for tasks without loaded conversations', () => {
    useConversationStore.setState({ conversations: {} })

    const event = makeEvent(3, 'TaskInstructionAdded', { taskId: 'task-unknown', instruction: 'test' })
    eventBus.emit('domain-event', event)

    const msgs = useConversationStore.getState().getMessages('task-unknown')
    expect(msgs).toHaveLength(0)
  })
})
