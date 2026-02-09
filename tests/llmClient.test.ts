import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    generateText: vi.fn(),
    streamText: vi.fn(),
    jsonSchema: vi.fn((schema: unknown) => ({ schema })),
    createOpenAICompatible: vi.fn()
  }
})

vi.mock('nanoid', () => ({
  nanoid: (size?: number) => `id_${size ?? 21}`
}))

vi.mock('ai', () => {
  return {
    generateText: mocks.generateText,
    streamText: mocks.streamText,
    jsonSchema: mocks.jsonSchema
  }
})

vi.mock('@ai-sdk/openai-compatible', () => {
  return {
    createOpenAICompatible: mocks.createOpenAICompatible
  }
})

import { OpenAILLMClient, toToolCallRequests } from '../src/infra/openaiLLMClient.js'

describe('OpenAILLMClient (LLMClient port)', () => {
  beforeEach(() => {
    mocks.generateText.mockReset()
    mocks.streamText.mockReset()
    mocks.createOpenAICompatible.mockReset()
  })

  test('throws a readable error when api key is missing', () => {
    expect(
      () =>
        new OpenAILLMClient({
          apiKey: null,
          modelByProfile: { fast: 'm1', writer: 'm2', reasoning: 'm3' }
        })
    ).toThrow(/COAUTHOR_OPENAI_API_KEY/)
  })

  test('complete routes by profile and returns LLMResponse', async () => {
    mocks.createOpenAICompatible.mockReturnValue((modelId: string) => ({ modelId }))
    mocks.generateText.mockResolvedValue({ 
      text: 'hello', 
      toolCalls: [],
      finishReason: 'stop'
    })

    const llm = new OpenAILLMClient({
      apiKey: 'k',
      modelByProfile: { fast: 'fast-model', writer: 'writer-model', reasoning: 'reasoning-model' }
    })

    const response = await llm.complete({
      profile: 'writer',
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'U' }
      ],
      maxTokens: 123
    })

    expect(response.content).toBe('hello')
    expect(response.stopReason).toBe('end_turn')
    expect(mocks.generateText).toHaveBeenCalledTimes(1)
    const args = mocks.generateText.mock.calls[0]![0] as any
    expect(args.model.modelId).toBe('writer-model')
    expect(args.maxOutputTokens).toBe(123)
  })

  test('stream calls onChunk and returns LLMResponse', async () => {
    mocks.createOpenAICompatible.mockReturnValue((modelId: string) => ({ modelId }))
    mocks.streamText.mockResolvedValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'a' }
        yield { type: 'text-delta', text: 'b' }
        yield { type: 'finish', finishReason: 'stop' }
      })()
    })

    const llm = new OpenAILLMClient({
      apiKey: 'k',
      modelByProfile: { fast: 'fast-model', writer: 'writer-model', reasoning: 'reasoning-model' }
    })

    const out: unknown[] = []
    const response = await llm.stream({
      profile: 'fast',
      messages: [{ role: 'user', content: 'hi' }]
    }, (chunk) => {
      out.push(chunk)
    })

    expect(out.length).toBeGreaterThan(0)
    expect(out[0]).toEqual({ type: 'text', content: 'a' })
    expect(out[1]).toEqual({ type: 'text', content: 'b' })
    expect(response.content).toBe('ab')
    expect(response.stopReason).toBe('end_turn')
    const args = mocks.streamText.mock.calls[0]![0] as any
    expect(args.model.modelId).toBe('fast-model')
  })
})

describe('toToolCallRequests', () => {
  test('returns empty array for undefined input', () => {
    expect(toToolCallRequests(undefined)).toEqual([])
  })

  test('returns empty array for empty input', () => {
    expect(toToolCallRequests([])).toEqual([])
  })

  test('converts valid tool calls', () => {
    const input = [
      { toolCallId: 'call_1', toolName: 'test_tool', args: { foo: 'bar' } }
    ]
    const expected = [
      { toolCallId: 'call_1', toolName: 'test_tool', arguments: { foo: 'bar' } }
    ]
    expect(toToolCallRequests(input)).toEqual(expected)
  })

  test('generates id if missing', () => {
    const input = [
      { toolName: 'test_tool', args: { foo: 'bar' } }
    ]
    const result = toToolCallRequests(input)
    expect(result[0].toolCallId).toBe('tool_id_12')
    expect(result[0].toolName).toBe('test_tool')
  })

  test('defaults arguments to empty object if missing', () => {
    const input = [
      { toolCallId: 'call_1', toolName: 'test_tool' }
    ]
    const result = toToolCallRequests(input)
    expect(result[0].arguments).toEqual({})
  })
})
