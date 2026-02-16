import { describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => {
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
  it('maps Bailian policy options to providerOptions', async () => {
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
              webSearch: {
                enabled: true,
                onlyWhenNoFunctionTools: true,
              },
            },
            provider: {
              bailian: {
                thinkingBudget: 128,
                forcedSearch: true,
                searchStrategy: 'max',
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

    await client.complete({
      profile: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    })

    const callArgs = generateTextMock.mock.calls.at(-1)?.[0] as { providerOptions?: unknown } | undefined
    expect(callArgs?.providerOptions).toEqual({
      openai: {
        enable_thinking: true,
        thinking_budget: 128,
        enable_search: true,
        search_options: {
          forced_search: true,
          search_strategy: 'max',
        },
      },
    })
  })

  it('maps Volcengine policy options and injects web_search only when no local tools', async () => {
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
          web: {
            openaiCompat: {
              webSearch: {
                enabled: true,
                onlyWhenNoFunctionTools: true,
                maxKeyword: 2,
                limit: 6,
                sources: ['toutiao', 'douyin'],
              },
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
          fast: { model: 'doubao-seed', clientPolicy: 'web' },
          writer: { model: 'doubao-seed', clientPolicy: 'web' },
          reasoning: { model: 'doubao-seed', clientPolicy: 'web' },
        },
      },
    })

    expect(client.label).toBe('Volcengine')

    await client.complete({
      profile: 'fast',
      messages: [{ role: 'user', content: 'latest AI news' }],
    })

    let callArgs = generateTextMock.mock.calls.at(-1)?.[0] as { providerOptions?: unknown } | undefined
    expect(callArgs?.providerOptions).toEqual({
      openai: {
        thinking: { type: 'auto' },
        reasoning_effort: 'medium',
        tools: [{
          type: 'web_search',
          max_keyword: 2,
          limit: 6,
          sources: ['toutiao', 'douyin'],
        }],
      },
    })

    await client.complete({
      profile: 'fast',
      messages: [{ role: 'user', content: 'use local tools' }],
      tools: [{
        name: 'local_tool',
        description: 'local',
        parameters: { type: 'object', properties: {} },
      }],
    })

    callArgs = generateTextMock.mock.calls.at(-1)?.[0] as { providerOptions?: unknown } | undefined
    expect(callArgs?.providerOptions).toEqual({
      openai: {
        thinking: { type: 'auto' },
        reasoning_effort: 'medium',
      },
    })
  })
})
