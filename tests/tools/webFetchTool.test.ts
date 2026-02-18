import { afterEach, describe, expect, test } from 'vitest'

import type { ArtifactStore } from '../../src/core/ports/artifactStore.js'
import type { ToolContext } from '../../src/core/ports/tool.js'
import { OpenAILLMClient } from '../../src/infrastructure/llm/openaiLLMClient.js'
import { BailianLLMClient } from '../../src/infrastructure/llm/bailianLLMClient.js'
import { VolcengineLLMClient } from '../../src/infrastructure/llm/volcengineLLMClient.js'
import { createWebFetchTool } from '../../src/infrastructure/tools/webFetch.js'

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

const artifactStore: ArtifactStore = {
  readFile: async () => '',
  readFileRange: async () => '',
  listDir: async () => [],
  writeFile: async () => {},
  exists: async () => false,
  mkdir: async () => {},
  glob: async () => [],
  stat: async () => null,
}

const ctx: ToolContext = {
  taskId: 'task-1',
  actorId: 'actor-1',
  baseDir: process.cwd(),
  artifactStore,
}

describe('web_fetch tool', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('validates prompt contains at least one http/https URL', async () => {
    const llm = new BailianLLMClient({
      apiKey: 'bailian-key',
      profileCatalog: createProfileCatalog('qwen-web'),
    })

    const tool = createWebFetchTool({
      llm,
      profile: 'research_web',
    })

    const result = await tool.execute({ prompt: 'summarize this page please' }, ctx)

    expect(result.isError).toBe(true)
    expect(result.output).toEqual({ error: 'prompt must include at least one http/https URL' })
  })

  test('returns successful content for Bailian native fetch', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        output_text: 'fetched page summary',
      }), { status: 200 })
    }) as typeof fetch

    const llm = new BailianLLMClient({
      apiKey: 'bailian-key',
      profileCatalog: createProfileCatalog('qwen-web'),
    })

    const tool = createWebFetchTool({
      llm,
      profile: 'research_web',
    })

    const result = await tool.execute({ prompt: 'Summarize https://example.com/docs' }, ctx)

    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({
      provider: 'bailian',
      profile: 'research_web',
      urls: ['https://example.com/docs'],
      content: 'fetched page summary',
    })
  })

  test('returns deterministic unsupported result for Volcengine', async () => {
    const llm = new VolcengineLLMClient({
      apiKey: 'volc-key',
      profileCatalog: createProfileCatalog('doubao-web'),
    })

    const tool = createWebFetchTool({
      llm,
      profile: 'research_web',
    })

    const result = await tool.execute({ prompt: 'Summarize https://example.com' }, ctx)

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      provider: 'volcengine',
      status: 'unsupported',
    })
  })

  test('returns deterministic unsupported result for OpenAI provider', async () => {
    const llm = new OpenAILLMClient({
      provider: 'openai',
      apiKey: 'openai-key',
      profileCatalog: createProfileCatalog('gpt-web'),
    })

    const tool = createWebFetchTool({
      llm,
      profile: 'research_web',
    })

    const result = await tool.execute({ prompt: 'Summarize https://example.com' }, ctx)

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      provider: 'openai',
      status: 'unsupported',
    })
  })
})
