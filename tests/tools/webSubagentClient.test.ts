import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => {
    return (modelId: string) => ({ modelId })
  },
}))

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  jsonSchema: vi.fn((schema: unknown) => ({ schema })),
}))

vi.mock('ai', () => ({
  generateText: mocks.generateText,
  streamText: mocks.streamText,
  jsonSchema: mocks.jsonSchema,
}))

import { FakeLLMClient } from '../../src/infrastructure/llm/fakeLLMClient.js'
import { BailianLLMClient } from '../../src/infrastructure/llm/bailianLLMClient.js'
import { VolcengineLLMClient } from '../../src/infrastructure/llm/volcengineLLMClient.js'
import { executeWebFetchSubagent, executeWebSearchSubagent } from '../../src/infrastructure/tools/webSubagentClient.js'

function createProfileCatalog(model = 'model-web') {
  return {
    defaultProfile: 'fast',
    clientPolicies: {
      default: {
        openaiCompat: {
          enableThinking: true,
        },
      },
    },
    profiles: {
      fast: { model: 'model-fast', clientPolicy: 'default' },
      writer: { model: 'model-writer', clientPolicy: 'default' },
      reasoning: { model: 'model-reasoning', clientPolicy: 'default' },
      research_web: { model, clientPolicy: 'default' },
    },
  }
}

describe('webSubagentClient', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    mocks.generateText.mockReset()
    mocks.streamText.mockReset()
    mocks.jsonSchema.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('builds Bailian search payload with enable_search=true', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'bailian search content' } }],
      }), { status: 200 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const llm = new BailianLLMClient({
      apiKey: 'bailian-key',
      profileCatalog: createProfileCatalog('qwen-web'),
    })

    const result = await executeWebSearchSubagent({
      llm,
      profile: 'research_web',
      prompt: 'latest AI updates',
    })

    expect(result.status).toBe('success')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')

    const payload = JSON.parse(String(init.body))
    expect(payload).toEqual({
      model: 'qwen-web',
      messages: [{ role: 'user', content: 'latest AI updates' }],
      enable_search: true,
    })
  })

  test('adds qwen3-max search strategy in non-thinking native web search', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'bailian search content' } }],
      }), { status: 200 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const llm = new BailianLLMClient({
      apiKey: 'bailian-key',
      profileCatalog: createProfileCatalog('qwen3-max-2026-01-23'),
    })

    const result = await executeWebSearchSubagent({
      llm,
      profile: 'research_web',
      prompt: 'latest AI updates',
    })

    expect(result.status).toBe('success')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(String(init.body))
    expect(payload).toEqual({
      model: 'qwen3-max-2026-01-23',
      messages: [{ role: 'user', content: 'latest AI updates' }],
      enable_search: true,
      search_options: {
        search_strategy: 'agent',
      },
    })
  })

  test('builds Bailian fetch payload with responses web extractor tools', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({
        output_text: 'bailian fetch content',
      }), { status: 200 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const llm = new BailianLLMClient({
      apiKey: 'bailian-key',
      profileCatalog: createProfileCatalog('qwen-web'),
    })

    const result = await executeWebFetchSubagent({
      llm,
      profile: 'research_web',
      prompt: 'Summarize https://example.com/page',
    })

    expect(result.status).toBe('success')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/responses')
    const payload = JSON.parse(String(init.body))
    expect(payload).toEqual({
      model: 'qwen-web',
      input: 'Summarize https://example.com/page',
      tools: [
        { type: 'web_search' },
        { type: 'web_extractor' },
        { type: 'code_interpreter' },
      ],
      enable_thinking: true,
    })
  })

  test('builds Volcengine Responses payload with web_search tool', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({
        output_text: 'volcengine search content',
      }), { status: 200 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const llm = new VolcengineLLMClient({
      apiKey: 'volc-key',
      profileCatalog: createProfileCatalog('doubao-web'),
    })

    const result = await executeWebSearchSubagent({
      llm,
      profile: 'research_web',
      prompt: 'latest LLM pricing',
    })

    expect(result).toMatchObject({
      status: 'success',
      provider: 'volcengine',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/responses')

    const payload = JSON.parse(String(init.body))
    expect(payload).toEqual({
      model: 'doubao-web',
      input: 'latest LLM pricing',
      tools: [{ type: 'web_search' }],
    })
  })

  test('returns unsupported for providers without native web support', async () => {
    const llm = new FakeLLMClient()

    const result = await executeWebSearchSubagent({
      llm,
      profile: 'research_web',
      prompt: 'query',
    })

    expect(result).toEqual({
      status: 'unsupported',
      provider: 'fake',
      message: 'web_search is not supported for provider "fake"',
    })
  })

  test('maps HTTP failures to typed error result', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('upstream outage', { status: 503 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const llm = new BailianLLMClient({
      apiKey: 'bailian-key',
      profileCatalog: createProfileCatalog('qwen-web'),
    })

    const result = await executeWebSearchSubagent({
      llm,
      profile: 'research_web',
      prompt: 'query',
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') {
      throw new Error('Expected error result')
    }
    expect(result.provider).toBe('bailian')
    expect(result.statusCode).toBe(503)
    expect(result.message).toContain('HTTP 503')
  })
})
