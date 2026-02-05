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

describe('OpenAILLMClient.complete', () => {
  it('should map reasoningText into LLMResponse.reasoning', async () => {
    const { OpenAILLMClient } = await import('../src/infra/openaiLLMClient.js')

    generateTextMock.mockResolvedValueOnce({
      text: 'hello',
      reasoningText: 'reasoning',
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

    const result = await client.complete({
      profile: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result).toEqual({
      content: 'hello',
      reasoning: 'reasoning',
      stopReason: 'end_turn',
    })
  })

  it('should include assistant reasoning and tool-call input when sending history to AI SDK', async () => {
    const { OpenAILLMClient } = await import('../src/infra/openaiLLMClient.js')

    generateTextMock.mockResolvedValueOnce({
      text: 'ok',
      reasoningText: undefined,
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

    await client.complete({
      profile: 'fast',
      messages: [
        {
          role: 'assistant',
          content: 'previous',
          reasoning: 'think',
          toolCalls: [{ toolCallId: 'tc1', toolName: 'myTool', arguments: { a: 1 } }],
        },
      ],
    })

    const callArgs = generateTextMock.mock.calls.at(-1)?.[0] as { messages?: unknown[] } | undefined
    expect(callArgs?.messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'text', text: 'previous' },
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'myTool', input: { a: 1 } },
        ],
      },
    ])
  })
})
