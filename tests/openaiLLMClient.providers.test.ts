import { beforeEach, describe, expect, it, vi } from 'vitest'

let lastOpenAICompatibleCreateOptions:
  | { transformRequestBody?: (args: Record<string, unknown>) => Record<string, unknown> }
  | undefined

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (options: { transformRequestBody?: (args: Record<string, unknown>) => Record<string, unknown> }) => {
    lastOpenAICompatibleCreateOptions = options
    return (modelId: string) => ({ modelId })
  },
}))

const generateTextMock = vi.fn()
const streamTextMock = vi.fn()
const jsonSchemaMock = vi.fn((schema: unknown) => ({ schema }))

vi.mock('ai', () => ({
  generateText: generateTextMock,
  streamText: streamTextMock,
  jsonSchema: jsonSchemaMock,
}))

describe('OpenAI-compatible provider adapters', () => {
  beforeEach(() => {
    lastOpenAICompatibleCreateOptions = undefined
    generateTextMock.mockReset()
    streamTextMock.mockReset()
    jsonSchemaMock.mockClear()
  })

  it('maps Bailian policy options to providerOptions without web-search fields', async () => {
    const { OpenAILLMClient } = await import('../src/infrastructure/llm/openaiLLMClient.js')

    generateTextMock.mockResolvedValueOnce({
      text: 'ok',
      reasoningText: 'r',
      toolCalls: [],
      finishReason: 'stop',
    })

    const client = new OpenAILLMClient({
      provider: 'bailian',
      apiKey: 'test',
      profileCatalog: {
        defaultProfile: 'fast',
        clientPolicies: {
          balanced: {
            openaiCompat: {
              enableThinking: true,
            },
            provider: {
              bailian: {
                thinkingBudget: 128,
              },
            },
          },
        },
        profiles: {
          fast: { model: 'qwen-plus', clientPolicy: 'balanced' },
          writer: { model: 'qwen-plus', clientPolicy: 'balanced' },
          reasoning: { model: 'qwen-plus', clientPolicy: 'balanced' },
        },
      },
    })

    expect(client.label).toBe('Bailian')
    expect(lastOpenAICompatibleCreateOptions?.transformRequestBody).toBeUndefined()

    await client.complete({
      profile: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    })

    const callArgs = generateTextMock.mock.calls.at(-1)?.[0] as { providerOptions?: unknown } | undefined
    expect(callArgs?.providerOptions).toEqual({
      bailian: {
        enable_thinking: true,
        thinking_budget: 128,
      },
    })
  })

  it('maps Volcengine policy options without any web-search transform hook', async () => {
    const { OpenAILLMClient } = await import('../src/infrastructure/llm/openaiLLMClient.js')

    generateTextMock.mockResolvedValue({
      text: 'ok',
      reasoningText: 'r',
      toolCalls: [],
      finishReason: 'stop',
    })

    const client = new OpenAILLMClient({
      provider: 'volcengine',
      apiKey: 'test',
      profileCatalog: {
        defaultProfile: 'fast',
        clientPolicies: {
          strict: {
            openaiCompat: {
              enableThinking: true,
            },
            provider: {
              volcengine: {
                thinkingType: 'auto',
                reasoningEffort: 'medium',
              },
            },
          },
        },
        profiles: {
          fast: { model: 'doubao-seed', clientPolicy: 'strict' },
          writer: { model: 'doubao-seed', clientPolicy: 'strict' },
          reasoning: { model: 'doubao-seed', clientPolicy: 'strict' },
        },
      },
    })

    expect(client.label).toBe('Volcengine')
    expect(lastOpenAICompatibleCreateOptions?.transformRequestBody).toBeUndefined()

    await client.complete({
      profile: 'fast',
      messages: [{ role: 'user', content: 'latest AI news' }],
      tools: [{
        name: 'local_tool',
        description: 'local',
        parameters: { type: 'object', properties: {} },
      }],
    })

    const callArgs = generateTextMock.mock.calls.at(-1)?.[0] as { providerOptions?: unknown } | undefined
    expect(callArgs?.providerOptions).toEqual({
      volcengine: {
        thinking: { type: 'auto' },
        reasoning_effort: 'medium',
      },
    })
  })

  it('does not inject tools for OpenAI provider', async () => {
    const { OpenAILLMClient } = await import('../src/infrastructure/llm/openaiLLMClient.js')

    generateTextMock.mockResolvedValue({
      text: 'ok',
      reasoningText: 'r',
      toolCalls: [],
      finishReason: 'stop',
    })

    const client = new OpenAILLMClient({
      provider: 'openai',
      apiKey: 'test',
      profileCatalog: {
        defaultProfile: 'fast',
        clientPolicies: {
          strict: {
            openaiCompat: {
              enableThinking: true,
            },
          },
        },
        profiles: {
          fast: { model: 'gpt-4o-mini', clientPolicy: 'strict' },
          writer: { model: 'gpt-4o-mini', clientPolicy: 'strict' },
          reasoning: { model: 'gpt-4o-mini', clientPolicy: 'strict' },
        },
      },
    })

    expect(lastOpenAICompatibleCreateOptions?.transformRequestBody).toBeUndefined()

    await client.complete({
      profile: 'fast',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{
        name: 'local_tool',
        description: 'local',
        parameters: { type: 'object', properties: {} },
      }],
    })

    const callArgs = generateTextMock.mock.calls.at(-1)?.[0] as { providerOptions?: unknown } | undefined
    expect(callArgs?.providerOptions).toEqual({
      openai: {
        enable_thinking: true,
      },
    })
  })
})
