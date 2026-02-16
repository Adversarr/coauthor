import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlConversationStore } from '../src/infrastructure/persistence/jsonlConversationStore.js'
import type { LLMMessage } from '../src/core/ports/llmClient.js'

describe('ConversationStore', () => {
  let dir: string
  let store: JsonlConversationStore

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'seed-conv-'))
    store = new JsonlConversationStore({
      conversationsPath: join(dir, 'conversations.jsonl')
    })
    await store.ensureSchema()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('append/getMessages persists conversation per taskId', async () => {
    const msg1: LLMMessage = { role: 'system', content: 'You are a helpful assistant.' }
    const msg2: LLMMessage = { role: 'user', content: 'Hello!' }
    const msg3: LLMMessage = { role: 'assistant', content: 'Hi there!' }

    await store.append('task1', msg1)
    await store.append('task1', msg2)
    await store.append('task1', msg3)

    const messages = await store.getMessages('task1')
    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual(msg1)
    expect(messages[1]).toEqual(msg2)
    expect(messages[2]).toEqual(msg3)
  })

  test('messages are isolated by taskId', async () => {
    await store.append('task1', { role: 'user', content: 'Task 1 message' })
    await store.append('task2', { role: 'user', content: 'Task 2 message' })

    const task1Messages = await store.getMessages('task1')
    const task2Messages = await store.getMessages('task2')

    expect(task1Messages).toHaveLength(1)
    expect(task1Messages[0]?.content).toBe('Task 1 message')
    expect(task2Messages).toHaveLength(1)
    expect(task2Messages[0]?.content).toBe('Task 2 message')
  })

  test('getMessages returns empty array for unknown taskId', async () => {
    const messages = await store.getMessages('nonexistent')
    expect(messages).toEqual([])
  })

  test('messages survive store re-instantiation (persistence)', async () => {
    const msg: LLMMessage = { role: 'user', content: 'Persistent message' }
    await store.append('task1', msg)

    // Create new store instance pointing to same file
    const newStore = new JsonlConversationStore({
      conversationsPath: join(dir, 'conversations.jsonl')
    })
    // No need to call ensureSchema() - file already exists

    const messages = await newStore.getMessages('task1')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(msg)
  })

  test('truncate removes oldest messages keeping last N', async () => {
    await store.append('task1', { role: 'user', content: 'msg1' })
    await store.append('task1', { role: 'assistant', content: 'msg2' })
    await store.append('task1', { role: 'user', content: 'msg3' })
    await store.append('task1', { role: 'assistant', content: 'msg4' })
    await store.append('task1', { role: 'user', content: 'msg5' })

    await store.truncate('task1', 3)

    const messages = await store.getMessages('task1')
    expect(messages).toHaveLength(3)
    expect(messages[0]?.content).toBe('msg3')
    expect(messages[1]?.content).toBe('msg4')
    expect(messages[2]?.content).toBe('msg5')
  })

  test('truncate does nothing if messages <= keepLastN', async () => {
    await store.append('task1', { role: 'user', content: 'msg1' })
    await store.append('task1', { role: 'assistant', content: 'msg2' })

    await store.truncate('task1', 5)

    const messages = await store.getMessages('task1')
    expect(messages).toHaveLength(2)
  })

  test('truncate only affects specified taskId', async () => {
    await store.append('task1', { role: 'user', content: 'task1-msg1' })
    await store.append('task1', { role: 'user', content: 'task1-msg2' })
    await store.append('task2', { role: 'user', content: 'task2-msg1' })
    await store.append('task2', { role: 'user', content: 'task2-msg2' })

    await store.truncate('task1', 1)

    expect(await store.getMessages('task1')).toHaveLength(1)
    expect(await store.getMessages('task2')).toHaveLength(2) // Unaffected
  })

  test('clear removes all messages for a taskId', async () => {
    await store.append('task1', { role: 'user', content: 'msg1' })
    await store.append('task1', { role: 'assistant', content: 'msg2' })

    await store.clear('task1')

    const messages = await store.getMessages('task1')
    expect(messages).toEqual([])
  })

  test('clear only affects specified taskId', async () => {
    await store.append('task1', { role: 'user', content: 'task1-msg' })
    await store.append('task2', { role: 'user', content: 'task2-msg' })

    await store.clear('task1')

    expect(await store.getMessages('task1')).toEqual([])
    expect(await store.getMessages('task2')).toHaveLength(1)
  })

  test('message ordering is preserved by index', async () => {
    // Append messages in specific order
    await store.append('task1', { role: 'system', content: '1' })
    await store.append('task1', { role: 'user', content: '2' })
    await store.append('task1', { role: 'assistant', content: '3' })
    await store.append('task1', { role: 'tool', toolCallId: 'tc1', content: '4' })
    await store.append('task1', { role: 'user', content: '5' })

    const messages = await store.getMessages('task1')
    expect(messages.map(m => m.content)).toEqual(['1', '2', '3', '4', '5'])
  })

  test('readAll returns all entries with metadata', async () => {
    await store.append('task1', { role: 'user', content: 'msg1' })
    await store.append('task2', { role: 'user', content: 'msg2' })

    const entries = await store.readAll()
    expect(entries).toHaveLength(2)
    expect(entries[0]?.id).toBe(1)
    expect(entries[0]?.taskId).toBe('task1')
    expect(entries[0]?.index).toBe(0)
    expect(entries[0]?.createdAt).toBeDefined()
    expect(entries[1]?.id).toBe(2)
    expect(entries[1]?.taskId).toBe('task2')
    expect(entries[1]?.index).toBe(0) // First message for task2
  })

  test('assistant message with toolCalls is persisted correctly', async () => {
    const assistantMsg: LLMMessage = {
      role: 'assistant',
      content: 'I will help you with that.',
      toolCalls: [
        { toolCallId: 'tc1', toolName: 'readFile', arguments: { path: '/test.txt' } }
      ]
    }
    await store.append('task1', assistantMsg)

    const messages = await store.getMessages('task1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('assistant')
    expect((messages[0] as { toolCalls?: unknown[] }).toolCalls).toHaveLength(1)
  })

  test('tool message is persisted correctly', async () => {
    const toolMsg: LLMMessage = {
      role: 'tool',
      toolCallId: 'tc1',
      content: '{"result": "file contents"}'
    }
    await store.append('task1', toolMsg)

    const messages = await store.getMessages('task1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('tool')
    expect((messages[0] as { toolCallId: string }).toolCallId).toBe('tc1')
  })
})
