import { describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => {
    return (modelId: string) => ({ modelId })
  }
}))

const generateTextMock = vi.fn()
const streamTextMock = vi.fn()
const jsonSchemaMock = vi.fn((schema: unknown) => ({ schema }))

vi.mock('ai', () => ({
  generateText: generateTextMock,
  streamText: streamTextMock,
  jsonSchema: jsonSchemaMock,
}))

async function* createStreamParts(parts: Array<Record<string, unknown>>): AsyncGenerator<Record<string, unknown>> {
  for (const part of parts) {
    yield part
  }
}

describe('OpenAILLMClient.stream', () => {
  it('should call onChunk with reasoning and tool-call deltas, then return assembled LLMResponse', async () => {
    const { OpenAILLMClient } = await import('../src/infra/openaiLLMClient.js')

    streamTextMock.mockResolvedValueOnce({
      fullStream: createStreamParts([
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'think-' },
        { type: 'reasoning-delta', id: 'r1', delta: 'more' },
        { type: 'reasoning-end', id: 'r1' },

        { type: 'text-delta', delta: 'hello' },

        { type: 'tool-input-start', id: 'tc1', toolName: 'myTool' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{"a":' },
        { type: 'tool-input-delta', id: 'tc1', delta: '1}' },
        { type: 'tool-input-end', id: 'tc1' },

        { type: 'finish', finishReason: 'stop' },
      ]),
    })

    const client = new OpenAILLMClient({
      apiKey: 'test',
      modelByProfile: {
        fast: 'gpt-test',
        writer: 'gpt-test',
        reasoning: 'gpt-test',
      },
    })

    const chunks: Array<Record<string, unknown>> = []
    const response = await client.stream({
      profile: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    }, (chunk) => {
      chunks.push(chunk as unknown as Record<string, unknown>)
    })

    const streamCallArgs = streamTextMock.mock.calls.at(-1)?.[0] as { providerOptions?: unknown } | undefined
    expect(streamCallArgs?.providerOptions).toEqual({
      openai: {
        enable_thinking: true,
      },
    })

    expect(chunks).toEqual([
      { type: 'reasoning', content: 'think-' },
      { type: 'reasoning', content: 'more' },
      { type: 'text', content: 'hello' },
      { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'myTool' },
      { type: 'tool_call_delta', toolCallId: 'tc1', argumentsDelta: '{"a":' },
      { type: 'tool_call_delta', toolCallId: 'tc1', argumentsDelta: '1}' },
      { type: 'tool_call_end', toolCallId: 'tc1' },
      { type: 'done', stopReason: 'end_turn' },
    ])

    // Verify assembled response
    expect(response.content).toBe('hello')
    expect(response.reasoning).toBe('think-more')
    expect(response.stopReason).toBe('end_turn')
    expect(response.toolCalls).toEqual([
      { toolCallId: 'tc1', toolName: 'myTool', arguments: { a: 1 } },
    ])
  })

  it('should delegate to complete() when no onChunk callback is provided', async () => {
    const { OpenAILLMClient } = await import('../src/infra/openaiLLMClient.js')

    generateTextMock.mockResolvedValueOnce({
      text: 'answer',
      reasoningText: '',
      toolCalls: [],
      finishReason: 'stop',
    })

    const client = new OpenAILLMClient({
      apiKey: 'test',
      modelByProfile: {
        fast: 'gpt-test',
        writer: 'gpt-test',
        reasoning: 'gpt-test',
      },
    })

    const response = await client.stream({
      profile: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    })

    // Should use generateText (via complete), not streamText
    expect(generateTextMock).toHaveBeenCalled()
    expect(response.content).toBe('answer')
    expect(response.stopReason).toBe('end_turn')
  })
})
