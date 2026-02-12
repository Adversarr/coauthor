import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OutputHandler } from '../src/agents/orchestration/outputHandler.js'
import type { OutputContext } from '../src/agents/orchestration/outputHandler.js'
import type { UiBus, UiEvent } from '../src/core/ports/uiBus.js'
import type { LLMStreamChunk } from '../src/core/ports/llmClient.js'
import { FakeLLMClient } from '../src/infrastructure/llm/fakeLLMClient.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockUiBus(): UiBus & { emitted: UiEvent[] } {
  const emitted: UiEvent[] = []
  return {
    emitted,
    events$: { subscribe: () => ({ unsubscribe: () => {} }) },
    emit(event: UiEvent) {
      emitted.push(event)
    },
  }
}

function createHandler(uiBus: UiBus): OutputHandler {
  return new OutputHandler({
    toolExecutor: { execute: vi.fn(), recordRejection: vi.fn() } as any,
    toolRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn(), toOpenAIFormat: vi.fn() },
    artifactStore: {} as any,
    uiBus,
    conversationManager: {
      getPendingToolCalls: vi.fn(),
      persistToolResultIfMissing: vi.fn(),
    } as any,
  })
}

function baseCtx(overrides?: Partial<OutputContext>): OutputContext {
  return {
    taskId: 't1',
    agentId: 'agent1',
    baseDir: '/tmp',
    conversationHistory: [],
    persistMessage: vi.fn(),
    ...overrides,
  }
}

// ============================================================================
// OutputHandler.createStreamChunkHandler
// ============================================================================

describe('OutputHandler.createStreamChunkHandler', () => {
  let uiBus: ReturnType<typeof createMockUiBus>
  let handler: OutputHandler

  beforeEach(() => {
    uiBus = createMockUiBus()
    handler = createHandler(uiBus)
  })

  it('emits stream_delta for text chunks', () => {
    const ctx = baseCtx()
    const { onChunk } = handler.createStreamChunkHandler(ctx)

    onChunk({ type: 'text', content: 'hello' })

    expect(uiBus.emitted).toEqual([
      {
        type: 'stream_delta',
        payload: { taskId: 't1', agentId: 'agent1', kind: 'text', content: 'hello' },
      },
    ])
  })

  it('emits stream_delta for reasoning chunks', () => {
    const ctx = baseCtx()
    const { onChunk } = handler.createStreamChunkHandler(ctx)

    onChunk({ type: 'reasoning', content: 'thinking...' })

    expect(uiBus.emitted).toEqual([
      {
        type: 'stream_delta',
        payload: { taskId: 't1', agentId: 'agent1', kind: 'reasoning', content: 'thinking...' },
      },
    ])
  })

  it('emits stream_end on done chunk', () => {
    const ctx = baseCtx()
    const { onChunk } = handler.createStreamChunkHandler(ctx)

    onChunk({ type: 'done', stopReason: 'end_turn' })

    expect(uiBus.emitted).toEqual([
      {
        type: 'stream_end',
        payload: { taskId: 't1', agentId: 'agent1' },
      },
    ])
  })

  it('ignores tool_call_start, tool_call_delta, tool_call_end chunks', () => {
    const ctx = baseCtx()
    const { onChunk } = handler.createStreamChunkHandler(ctx)

    onChunk({ type: 'tool_call_start', toolCallId: 'tc1', toolName: 'myTool' })
    onChunk({ type: 'tool_call_delta', toolCallId: 'tc1', argumentsDelta: '{"a":1}' })
    onChunk({ type: 'tool_call_end', toolCallId: 'tc1' })

    expect(uiBus.emitted).toEqual([])
  })

  it('emits full sequence: reasoning → text → done in correct order', () => {
    const ctx = baseCtx()
    const { onChunk } = handler.createStreamChunkHandler(ctx)

    onChunk({ type: 'reasoning', content: 'step 1' })
    onChunk({ type: 'reasoning', content: ' step 2' })
    onChunk({ type: 'text', content: 'answer part 1' })
    onChunk({ type: 'text', content: ' part 2' })
    onChunk({ type: 'done', stopReason: 'end_turn' })

    expect(uiBus.emitted.map((e) => e.type)).toEqual([
      'stream_delta',
      'stream_delta',
      'stream_delta',
      'stream_delta',
      'stream_end',
    ])

    // Reasoning comes first
    expect(uiBus.emitted[0]).toMatchObject({
      type: 'stream_delta',
      payload: { kind: 'reasoning', content: 'step 1' },
    })
    expect(uiBus.emitted[1]).toMatchObject({
      type: 'stream_delta',
      payload: { kind: 'reasoning', content: ' step 2' },
    })
    // Then text
    expect(uiBus.emitted[2]).toMatchObject({
      type: 'stream_delta',
      payload: { kind: 'text', content: 'answer part 1' },
    })
    expect(uiBus.emitted[3]).toMatchObject({
      type: 'stream_delta',
      payload: { kind: 'text', content: ' part 2' },
    })
  })

  it('uses the correct taskId and agentId from context', () => {
    const ctx = baseCtx({ taskId: 'task-42', agentId: 'search-agent' })
    const { onChunk } = handler.createStreamChunkHandler(ctx)

    onChunk({ type: 'text', content: 'hi' })

    expect(uiBus.emitted[0]).toMatchObject({
      payload: { taskId: 'task-42', agentId: 'search-agent' },
    })
  })
})

// ============================================================================
// OutputHandler suppression when streamingEnabled
// ============================================================================

describe('OutputHandler agent_output suppression with streamingEnabled', () => {
  let uiBus: ReturnType<typeof createMockUiBus>
  let handler: OutputHandler

  beforeEach(() => {
    uiBus = createMockUiBus()
    handler = createHandler(uiBus)
  })

  it('suppresses agent_output for text when streamingEnabled is true', async () => {
    const ctx = baseCtx({ streamingEnabled: true })
    await handler.handle({ kind: 'text', content: 'hello' }, ctx)

    const agentOutputs = uiBus.emitted.filter((e) => e.type === 'agent_output')
    expect(agentOutputs).toEqual([])
  })

  it('suppresses agent_output for reasoning when streamingEnabled is true', async () => {
    const ctx = baseCtx({ streamingEnabled: true })
    await handler.handle({ kind: 'reasoning', content: 'thinking' }, ctx)

    const agentOutputs = uiBus.emitted.filter((e) => e.type === 'agent_output')
    expect(agentOutputs).toEqual([])
  })

  it('still emits agent_output for text when streamingEnabled is false', async () => {
    const ctx = baseCtx({ streamingEnabled: false })
    await handler.handle({ kind: 'text', content: 'hello' }, ctx)

    expect(uiBus.emitted).toEqual([
      {
        type: 'agent_output',
        payload: { taskId: 't1', agentId: 'agent1', kind: 'text', content: 'hello' },
      },
    ])
  })

  it('still emits agent_output for reasoning when streamingEnabled is false', async () => {
    const ctx = baseCtx({ streamingEnabled: false })
    await handler.handle({ kind: 'reasoning', content: 'think' }, ctx)

    expect(uiBus.emitted).toEqual([
      {
        type: 'agent_output',
        payload: { taskId: 't1', agentId: 'agent1', kind: 'reasoning', content: 'think' },
      },
    ])
  })

  it('always emits agent_output for verbose regardless of streamingEnabled', async () => {
    const ctx = baseCtx({ streamingEnabled: true })
    await handler.handle({ kind: 'verbose', content: 'verbose info' }, ctx)

    expect(uiBus.emitted).toEqual([
      {
        type: 'agent_output',
        payload: { taskId: 't1', agentId: 'agent1', kind: 'verbose', content: 'verbose info' },
      },
    ])
  })

  it('always emits agent_output for error regardless of streamingEnabled', async () => {
    const ctx = baseCtx({ streamingEnabled: true })
    await handler.handle({ kind: 'error', content: 'something broke' }, ctx)

    expect(uiBus.emitted).toEqual([
      {
        type: 'agent_output',
        payload: { taskId: 't1', agentId: 'agent1', kind: 'error', content: 'something broke' },
      },
    ])
  })
})

// ============================================================================
// FakeLLMClient.stream callback integration
// ============================================================================

describe('FakeLLMClient.stream callback', () => {
  it('calls onChunk with reasoning, text, done in correct order', async () => {
    const client = new FakeLLMClient({
      defaultByProfile: {
        fast: {
          content: 'answer text',
          reasoning: 'my reasoning',
          stopReason: 'end_turn',
        },
      },
    })

    const chunks: LLMStreamChunk[] = []
    const response = await client.stream(
      {
        profile: 'fast',
        messages: [{ role: 'user', content: 'hi' }],
      },
      (chunk) => chunks.push(chunk),
    )

    // Verify chunk order: reasoning before text before done
    const types = chunks.map((c) => c.type)
    expect(types).toEqual(['reasoning', 'text', 'done'])

    // Verify content
    expect(chunks[0]).toEqual({ type: 'reasoning', content: 'my reasoning' })
    expect(chunks[1]).toEqual({ type: 'text', content: 'answer text' })
    expect(chunks[2]).toEqual({ type: 'done', stopReason: 'end_turn' })

    // Verify returned response
    expect(response.content).toBe('answer text')
    expect(response.reasoning).toBe('my reasoning')
    expect(response.stopReason).toBe('end_turn')
  })

  it('includes tool call chunks between text and done', async () => {
    const client = new FakeLLMClient({
      rules: [
        {
          whenIncludes: 'use tools',
          returns: {
            content: 'I will use tools',
            stopReason: 'tool_use',
            toolCalls: [
              { toolCallId: 'tc1', toolName: 'readFile', arguments: { path: 'a.txt' } },
            ],
          },
        },
      ],
    })

    const chunks: LLMStreamChunk[] = []
    await client.stream(
      {
        profile: 'fast',
        messages: [{ role: 'user', content: 'use tools' }],
      },
      (chunk) => chunks.push(chunk),
    )

    const types = chunks.map((c) => c.type)
    expect(types).toEqual([
      'text',
      'tool_call_start',
      'tool_call_delta',
      'tool_call_end',
      'done',
    ])
  })

  it('returns response without calling onChunk when no callback provided', async () => {
    const client = new FakeLLMClient()
    const response = await client.stream({
      profile: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.content).toBeTruthy()
    expect(response.stopReason).toBe('end_turn')
  })
})

// ============================================================================
// End-to-end: FakeLLMClient → OutputHandler stream → UiBus event ordering
// ============================================================================

describe('Streaming end-to-end: LLM → OutputHandler → UiBus', () => {
  it('produces stream_delta events in correct order (reasoning before text)', async () => {
    const uiBus = createMockUiBus()
    const handler = createHandler(uiBus)
    const ctx = baseCtx({ streamingEnabled: true })

    const client = new FakeLLMClient({
      defaultByProfile: {
        fast: {
          content: 'final answer',
          reasoning: 'deep thought',
          stopReason: 'end_turn',
        },
      },
    })

    const { onChunk } = handler.createStreamChunkHandler(ctx)
    const response = await client.stream(
      { profile: 'fast', messages: [{ role: 'user', content: 'hi' }] },
      onChunk,
    )

    // After stream: UiBus should have reasoning delta, text delta, then stream_end
    const eventTypes = uiBus.emitted.map((e) => e.type)
    expect(eventTypes).toEqual(['stream_delta', 'stream_delta', 'stream_end'])

    // First delta is reasoning
    expect(uiBus.emitted[0]).toMatchObject({
      type: 'stream_delta',
      payload: { kind: 'reasoning', content: 'deep thought' },
    })

    // Second delta is text
    expect(uiBus.emitted[1]).toMatchObject({
      type: 'stream_delta',
      payload: { kind: 'text', content: 'final answer' },
    })

    // Last is stream_end
    expect(uiBus.emitted[2]).toMatchObject({ type: 'stream_end' })

    // Now simulate what the agent does after stream() returns:
    // It yields reasoning then text to handleOutput — both should be suppressed
    uiBus.emitted.length = 0

    await handler.handle({ kind: 'reasoning', content: response.reasoning! }, ctx)
    await handler.handle({ kind: 'text', content: response.content }, ctx)

    // No agent_output events should be emitted (suppressed by streamingEnabled)
    expect(uiBus.emitted).toEqual([])
  })

  it('emits agent_output in non-streaming mode (no suppression)', async () => {
    const uiBus = createMockUiBus()
    const handler = createHandler(uiBus)
    const ctx = baseCtx({ streamingEnabled: false })

    const client = new FakeLLMClient({
      defaultByProfile: {
        fast: {
          content: 'answer',
          reasoning: 'thought',
          stopReason: 'end_turn',
        },
      },
    })

    const response = await client.complete({
      profile: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    })

    await handler.handle({ kind: 'reasoning', content: response.reasoning! }, ctx)
    await handler.handle({ kind: 'text', content: response.content }, ctx)

    expect(uiBus.emitted.map((e) => e.type)).toEqual(['agent_output', 'agent_output'])
    expect(uiBus.emitted[0]).toMatchObject({
      payload: { kind: 'reasoning', content: 'thought' },
    })
    expect(uiBus.emitted[1]).toMatchObject({
      payload: { kind: 'text', content: 'answer' },
    })
  })
})

// ============================================================================
// TUI stream_end commit ordering simulation
// ============================================================================

describe('TUI stream_end commit ordering', () => {
  /**
   * This test simulates the exact logic that main.tsx uses to commit
   * streaming buffers to the scrollback. The bug was that using nested
   * setState calls (calling addLog inside setStreamingX updaters) caused
   * unpredictable ordering. The fix uses refs for synchronous access.
   *
   * We verify here that the ref-based approach always produces entries
   * in the correct order: reasoning first, then text.
   */
  it('commits reasoning before text when both buffers are non-empty', () => {
    // Simulate the ref-based approach from main.tsx
    const reasoningRef = { current: '' }
    const textRef = { current: '' }
    const committed: Array<{ kind: 'reasoning' | 'text'; content: string }> = []

    function addReasoningLog(content: string) {
      committed.push({ kind: 'reasoning', content })
    }
    function addTextLog(content: string) {
      committed.push({ kind: 'text', content })
    }

    // Simulate stream_delta accumulation
    reasoningRef.current += 'thinking step 1 '
    reasoningRef.current += 'thinking step 2'
    textRef.current += 'answer part 1 '
    textRef.current += 'answer part 2'

    // Simulate stream_end handling (ref-based, no nested setState)
    const reasoningContent = reasoningRef.current
    const textContent = textRef.current
    if (reasoningContent) addReasoningLog(reasoningContent)
    if (textContent) addTextLog(textContent)
    reasoningRef.current = ''
    textRef.current = ''

    // Verify order: reasoning ALWAYS before text
    expect(committed).toEqual([
      { kind: 'reasoning', content: 'thinking step 1 thinking step 2' },
      { kind: 'text', content: 'answer part 1 answer part 2' },
    ])
  })

  it('commits only text when reasoning is empty', () => {
    const reasoningRef = { current: '' }
    const textRef = { current: '' }
    const committed: Array<{ kind: 'reasoning' | 'text'; content: string }> = []

    textRef.current = 'just the answer'

    const reasoningContent = reasoningRef.current
    const textContent = textRef.current
    if (reasoningContent) committed.push({ kind: 'reasoning', content: reasoningContent })
    if (textContent) committed.push({ kind: 'text', content: textContent })

    expect(committed).toEqual([{ kind: 'text', content: 'just the answer' }])
  })

  it('commits only reasoning when text is empty', () => {
    const reasoningRef = { current: '' }
    const textRef = { current: '' }
    const committed: Array<{ kind: 'reasoning' | 'text'; content: string }> = []

    reasoningRef.current = 'internal monologue'

    const reasoningContent = reasoningRef.current
    const textContent = textRef.current
    if (reasoningContent) committed.push({ kind: 'reasoning', content: reasoningContent })
    if (textContent) committed.push({ kind: 'text', content: textContent })

    expect(committed).toEqual([{ kind: 'reasoning', content: 'internal monologue' }])
  })

  it('commits nothing when both buffers are empty', () => {
    const reasoningRef = { current: '' }
    const textRef = { current: '' }
    const committed: Array<{ kind: string; content: string }> = []

    const reasoningContent = reasoningRef.current
    const textContent = textRef.current
    if (reasoningContent) committed.push({ kind: 'reasoning', content: reasoningContent })
    if (textContent) committed.push({ kind: 'text', content: textContent })

    expect(committed).toEqual([])
  })
})

// ============================================================================
// /stream command
// ============================================================================

describe('/stream command', () => {
  // We import handleCommand dynamically to avoid module resolution issues
  // with the full command context. Instead, test the parsing logic directly.

  it('handles /stream on', async () => {
    const { handleCommand } = await import('../src/interfaces/tui/commands.js')
    const setStreamingEnabled = vi.fn()
    const setStatus = vi.fn()
    const ctx = {
      app: { runtimeManager: { streamingEnabled: false } } as any,
      refresh: vi.fn(),
      setStatus,
      setReplayOutput: vi.fn(),
      focusedTaskId: null,
      setFocusedTaskId: vi.fn(),
      setShowTasks: vi.fn(),
      setShowVerbose: vi.fn(),
      setStreamingEnabled,
    }

    await handleCommand('/stream on', ctx)

    expect(setStreamingEnabled).toHaveBeenCalledWith(true)
    expect(setStatus).toHaveBeenCalledWith('Streaming enabled — LLM output will appear in real-time')
  })

  it('handles /stream off', async () => {
    const { handleCommand } = await import('../src/interfaces/tui/commands.js')
    const setStreamingEnabled = vi.fn()
    const setStatus = vi.fn()
    const ctx = {
      app: { runtimeManager: { streamingEnabled: true } } as any,
      refresh: vi.fn(),
      setStatus,
      setReplayOutput: vi.fn(),
      focusedTaskId: null,
      setFocusedTaskId: vi.fn(),
      setShowTasks: vi.fn(),
      setShowVerbose: vi.fn(),
      setStreamingEnabled,
    }

    await handleCommand('/stream off', ctx)

    expect(setStreamingEnabled).toHaveBeenCalledWith(false)
    expect(setStatus).toHaveBeenCalledWith('Streaming disabled — LLM output appears after completion')
  })

  it('handles /stream toggle (no argument)', async () => {
    const { handleCommand } = await import('../src/interfaces/tui/commands.js')
    const setStreamingEnabled = vi.fn()
    const setStatus = vi.fn()
    const ctx = {
      app: { runtimeManager: { streamingEnabled: false } } as any,
      refresh: vi.fn(),
      setStatus,
      setReplayOutput: vi.fn(),
      focusedTaskId: null,
      setFocusedTaskId: vi.fn(),
      setShowTasks: vi.fn(),
      setShowVerbose: vi.fn(),
      setStreamingEnabled,
    }

    await handleCommand('/stream', ctx)

    // When no argument, should toggle — runtimeManager was false, so now ON
    expect(setStreamingEnabled).toHaveBeenCalledWith(true)
    expect(setStatus).toHaveBeenCalledWith('Streaming enabled')
  })
})

// ============================================================================
// RuntimeManager streaming propagation
// ============================================================================

describe('RuntimeManager streaming propagation', () => {
  it('streamingEnabled defaults to false', async () => {
    // Lightweight import to avoid full infra setup
    const { RuntimeManager } = await import('../src/agents/orchestration/runtimeManager.js')

    const manager = new RuntimeManager({
      store: {} as any,
      taskService: {} as any,
      llm: {} as any,
      toolRegistry: {} as any,
      baseDir: '/tmp',
      conversationManager: {} as any,
      outputHandler: {} as any,
    })

    expect(manager.streamingEnabled).toBe(false)
  })

  it('streamingEnabled can be toggled', async () => {
    const { RuntimeManager } = await import('../src/agents/orchestration/runtimeManager.js')

    const manager = new RuntimeManager({
      store: {} as any,
      taskService: {} as any,
      llm: {} as any,
      toolRegistry: {} as any,
      baseDir: '/tmp',
      conversationManager: {} as any,
      outputHandler: {} as any,
    })

    manager.streamingEnabled = true
    expect(manager.streamingEnabled).toBe(true)

    manager.streamingEnabled = false
    expect(manager.streamingEnabled).toBe(false)
  })
})
