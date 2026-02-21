import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { LLMProvider } from '../../core/ports/llmClient.js'
import type {
  ClientPolicy,
  VolcengineThinkingType,
} from '../../config/llmProfileCatalog.js'

export type OpenAICompatibleProvider = Exclude<LLMProvider, 'fake'>

type OpenAICompatibleProviderPayload = ProviderOptions[string]

type ProviderAdapterBuildInput = {
  policy: ClientPolicy
}

type OpenAICompatibleProviderAdapter = {
  buildProviderOptions(input: ProviderAdapterBuildInput): OpenAICompatibleProviderPayload
}

class OpenAIAdapter implements OpenAICompatibleProviderAdapter {
  buildProviderOptions(input: ProviderAdapterBuildInput): OpenAICompatibleProviderPayload {
    const payload: OpenAICompatibleProviderPayload = {}

    if (typeof input.policy.openaiCompat?.enableThinking === 'boolean') {
      payload.enable_thinking = input.policy.openaiCompat.enableThinking
    }

    return payload
  }
}

class BailianAdapter implements OpenAICompatibleProviderAdapter {
  buildProviderOptions(input: ProviderAdapterBuildInput): OpenAICompatibleProviderPayload {
    const payload: OpenAICompatibleProviderPayload = {}

    if (typeof input.policy.openaiCompat?.enableThinking === 'boolean') {
      payload.enable_thinking = input.policy.openaiCompat.enableThinking
    }

    const providerPolicy = input.policy.provider?.bailian

    if (providerPolicy?.thinkingBudget && payload.enable_thinking === true) {
      payload.thinking_budget = providerPolicy.thinkingBudget
    }

    return payload
  }
}

class VolcengineAdapter implements OpenAICompatibleProviderAdapter {
  buildProviderOptions(input: ProviderAdapterBuildInput): OpenAICompatibleProviderPayload {
    const payload: OpenAICompatibleProviderPayload = {}
    const providerPolicy = input.policy.provider?.volcengine

    let thinkingType: VolcengineThinkingType | undefined = providerPolicy?.thinkingType
    if (!thinkingType && typeof input.policy.openaiCompat?.enableThinking === 'boolean') {
      thinkingType = input.policy.openaiCompat.enableThinking ? 'enabled' : 'disabled'
    }
    if (thinkingType) {
      payload.thinking = { type: thinkingType }
    }

    if (providerPolicy?.reasoningEffort) {
      payload.reasoning_effort = providerPolicy.reasoningEffort
    }

    return payload
  }
}

const providerOptionBuilders: Record<OpenAICompatibleProvider, OpenAICompatibleProviderAdapter> = {
  openai: new OpenAIAdapter(),
  bailian: new BailianAdapter(),
  volcengine: new VolcengineAdapter(),
}

export function providerDefaultBaseURL(provider: OpenAICompatibleProvider): string {
  if (provider === 'bailian') return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  if (provider === 'volcengine') return 'https://ark.cn-beijing.volces.com/api/v3'
  return 'https://api.openai.com/v1'
}

export function buildOpenAICompatibleProviderOptions(input: {
  provider: OpenAICompatibleProvider
  policy: ClientPolicy
}): ProviderOptions {
  const payload = providerOptionBuilders[input.provider].buildProviderOptions({
    policy: input.policy,
  })
  return {
    [input.provider]: payload,
  }
}
