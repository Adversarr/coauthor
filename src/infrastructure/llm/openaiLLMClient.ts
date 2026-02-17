import {
  generateText,
  streamText,
  type ModelMessage,
  type LanguageModel,
  AssistantModelMessage,
  TextPart,
  FilePart,
  ToolApprovalRequest,
  ToolCallPart,
  ToolResultPart,
} from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { nanoid } from 'nanoid'
import type {
  LLMClient,
  LLMCompleteOptions,
  LLMMessage,
  LLMProvider,
  LLMProfile,
  LLMProfileCatalog,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamOptions,
} from '../../core/ports/llmClient.js'
import type { ToolCallRequest } from '../../core/ports/tool.js'
import { convertToolDefinitionsToAISDKTools, type ToolSchemaStrategy } from '../tools/toolSchemaAdapter.js'
import { ReasoningPart } from '@ai-sdk/provider-utils'
import {
  toRuntimeProfileCatalog,
  type ClientPolicy,
  type LLMProfileCatalogConfig,
  type LLMProfileSpec,
  type VolcengineThinkingType,
} from '../../config/llmProfileCatalog.js'

// Convert our LLMMessage to ai-sdk ModelMessage format
function toModelMessages(messages: LLMMessage[]): ModelMessage[] {
  const toToolResultOutput = (content: string): { type: 'json'; value: unknown } | { type: 'text'; value: string } => {
    try {
      return { type: 'json', value: JSON.parse(content) as unknown }
    } catch {
      return { type: 'text', value: content }
    }
  }
  return messages.map((m): ModelMessage => {
    if (m.role === 'system') {
      return { role: 'system', content: m.content }
    }
    if (m.role === 'user') {
      return { role: 'user', content: m.content }
    }
    if (m.role === 'assistant') {
      const hasToolCalls = (m.toolCalls?.length ?? 0) > 0
      const hasReasoning = Boolean(m.reasoning)
      if (hasToolCalls || hasReasoning) {
        const parts: Array<TextPart | FilePart | ReasoningPart | ToolCallPart
        | ToolResultPart | ToolApprovalRequest> = []
        if (m.reasoning) {
          parts.push({ type: 'reasoning', text: m.reasoning } as ReasoningPart)
        }
        if (m.content) {
          parts.push({ type: 'text', text: m.content } as TextPart)
        }
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            parts.push({
              type: 'tool-call',
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: tc.arguments,
            } as ToolCallPart)
          }
        }
        return { role: 'assistant', content: parts } as ModelMessage
      }
      return { role: 'assistant', content: m.content ?? '' } as AssistantModelMessage
    }
    if (m.role === 'tool') {
      // Use 'as unknown as ModelMessage' to work around ai-sdk type changes
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: m.toolCallId,
            toolName: m.toolName ?? 'unknown',
            output: toToolResultOutput(m.content),
          },
        ],
      } as unknown as ModelMessage
    }
    throw new Error(`Unknown message role: ${(m as { role: string }).role}`)
  })
}

// Convert ai-sdk tool calls to our ToolCallRequest format
export function toToolCallRequests(toolCalls?: Array<{ toolCallId?: string; toolName: string; args?: unknown; input?: unknown }>): ToolCallRequest[] {
  return toolCalls?.map((tc) => ({
    toolCallId: tc.toolCallId ?? `tool_${nanoid(12)}`,
    toolName: tc.toolName,
    arguments: (tc.args ?? tc.input ?? {}) as Record<string, unknown>,
  })) ?? []
}

export type OpenAICompatibleProvider = Exclude<LLMProvider, 'fake'>

type ProviderAdapterBuildInput = {
  policy: ClientPolicy
}

type OpenAICompatibleProviderPayload = Record<string, unknown>
type OpenAICompatibleProviderOptions = Record<string, OpenAICompatibleProviderPayload>

type OpenAICompatibleProviderAdapter = {
  buildProviderOptions(input: ProviderAdapterBuildInput): OpenAICompatibleProviderPayload
}

class OpenAIAdapter implements OpenAICompatibleProviderAdapter {
  buildProviderOptions(input: ProviderAdapterBuildInput): OpenAICompatibleProviderPayload {
    const payload: Record<string, unknown> = {}

    if (typeof input.policy.openaiCompat?.enableThinking === 'boolean') {
      payload.enable_thinking = input.policy.openaiCompat.enableThinking
    }

    return payload
  }
}

class BailianAdapter implements OpenAICompatibleProviderAdapter {
  buildProviderOptions(input: ProviderAdapterBuildInput): OpenAICompatibleProviderPayload {
    const payload: Record<string, unknown> = {}

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
    const payload: Record<string, unknown> = {}
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

function providerDefaultBaseURL(provider: OpenAICompatibleProvider): string {
  if (provider === 'bailian') return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  if (provider === 'volcengine') return 'https://ark.cn-beijing.volces.com/api/v3'
  return 'https://api.openai.com/v1'
}

export class OpenAILLMClient implements LLMClient {
  readonly provider: OpenAICompatibleProvider
  readonly label: string
  readonly description: string
  readonly profileCatalog: LLMProfileCatalog
  readonly #openai: ReturnType<typeof createOpenAICompatible>
  readonly #toolSchemaStrategy: ToolSchemaStrategy
  readonly #verboseEnabled: boolean
  readonly #profileCatalogConfig: LLMProfileCatalogConfig
  readonly #adapters: Record<OpenAICompatibleProvider, OpenAICompatibleProviderAdapter>

  constructor(opts: {
    provider?: OpenAICompatibleProvider
    apiKey: string | null
    baseURL?: string | null
    profileCatalog: LLMProfileCatalogConfig
    toolSchemaStrategy?: ToolSchemaStrategy
    verbose?: boolean
  }) {
    this.provider = opts.provider ?? 'openai'

    if (!opts.apiKey) {
      throw new Error('Missing SEED_LLM_API_KEY (or inject apiKey via config)')
    }

    const providerName: Record<OpenAICompatibleProvider, string> = {
      openai: 'openai',
      bailian: 'bailian',
      volcengine: 'volcengine',
    }
    const labelByProvider: Record<OpenAICompatibleProvider, string> = {
      openai: 'OpenAI',
      bailian: 'Bailian',
      volcengine: 'Volcengine',
    }

    this.label = labelByProvider[this.provider]
    this.#openai = createOpenAICompatible({
      name: providerName[this.provider],
      apiKey: opts.apiKey,
      baseURL: opts.baseURL ?? providerDefaultBaseURL(this.provider),
    })

    this.#profileCatalogConfig = opts.profileCatalog
    this.profileCatalog = toRuntimeProfileCatalog(opts.profileCatalog)
    this.#toolSchemaStrategy = opts.toolSchemaStrategy ?? 'auto'

    const envVerbose = process.env.SEED_LLM_VERBOSE
    const envVerboseEnabled = envVerbose === '1' || envVerbose === 'true'
    this.#verboseEnabled = opts.verbose ?? envVerboseEnabled

    this.#adapters = {
      openai: new OpenAIAdapter(),
      bailian: new BailianAdapter(),
      volcengine: new VolcengineAdapter(),
    }

    this.description = this.profileCatalog.profiles.map((profile) => `${profile.id}=${profile.model}`).join(', ')
  }

  #resolveProfile(profileId: LLMProfile): { profile: LLMProfileSpec; policy: ClientPolicy } {
    const profile = this.#profileCatalogConfig.profiles[profileId]
    if (!profile) {
      const valid = this.profileCatalog.profiles.map((item) => item.id).join(', ')
      throw new Error(`Unknown LLM profile: ${profileId}. Valid profiles: ${valid}`)
    }

    const policy = this.#profileCatalogConfig.clientPolicies[profile.clientPolicy]
    if (!policy) {
      throw new Error(`Profile "${profileId}" references missing client policy "${profile.clientPolicy}"`)
    }

    return { profile, policy }
  }

  #buildProviderOptions(input: { policy: ClientPolicy }): OpenAICompatibleProviderOptions {
    const payload = this.#adapters[this.provider].buildProviderOptions({
      policy: input.policy,
    })
    return {
      [this.provider]: payload,
    }
  }

  #logVerbose(message: string, data?: Record<string, unknown>): void {
    if (!this.#verboseEnabled) return
    if (data) {
      console.log(`[OpenAILLMClient] ${message}`, data)
      return
    }
    console.log(`[OpenAILLMClient] ${message}`)
  }

  async complete(opts: LLMCompleteOptions): Promise<LLMResponse> {
    const resolved = this.#resolveProfile(opts.profile)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = convertToolDefinitionsToAISDKTools(opts.tools, this.#toolSchemaStrategy) as any
    const providerOptions = this.#buildProviderOptions({
      policy: resolved.policy,
    })

    this.#logVerbose('complete request', {
      profile: opts.profile,
      modelId: resolved.profile.model,
      messagesCount: opts.messages.length,
      toolsCount: opts.tools?.length ?? 0,
      maxTokens: opts.maxTokens ?? null,
      provider: this.provider,
      providerOptions,
    })

    const result = await generateText({
      model: this.#openai(resolved.profile.model) as unknown as LanguageModel,
      messages: toModelMessages(opts.messages),
      tools,
      maxOutputTokens: opts.maxTokens,
      abortSignal: opts.signal,
      // Provider payloads include non-standard fields on compatible gateways.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerOptions: providerOptions as any,
    })

    const toolCalls = toToolCallRequests(result.toolCalls)

    let stopReason: LLMResponse['stopReason'] = 'end_turn'
    if (result.finishReason === 'tool-calls') {
      stopReason = 'tool_use'
    } else if (result.finishReason === 'length') {
      stopReason = 'max_tokens'
    }

    this.#logVerbose('complete response', {
      finishReason: result.finishReason ?? null,
      stopReason,
      textLength: result.text?.length ?? 0,
      reasoningLength: result.reasoningText?.length ?? 0,
      toolCallsCount: toolCalls.length,
    })

    return {
      content: result.text || undefined,
      reasoning: result.reasoningText || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason,
    }
  }

  async stream(opts: LLMStreamOptions, onChunk?: (chunk: LLMStreamChunk) => void): Promise<LLMResponse> {
    // When no callback, delegate to complete() — no streaming overhead.
    if (!onChunk) return this.complete(opts)

    const resolved = this.#resolveProfile(opts.profile)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = convertToolDefinitionsToAISDKTools(opts.tools, this.#toolSchemaStrategy) as any
    const providerOptions = this.#buildProviderOptions({
      policy: resolved.policy,
    })

    this.#logVerbose('stream request', {
      profile: opts.profile,
      modelId: resolved.profile.model,
      messagesCount: opts.messages.length,
      toolsCount: opts.tools?.length ?? 0,
      maxTokens: opts.maxTokens ?? null,
      provider: this.provider,
    })

    const res = await streamText({
      model: this.#openai(resolved.profile.model) as unknown as LanguageModel,
      messages: toModelMessages(opts.messages),
      tools,
      maxOutputTokens: opts.maxTokens,
      abortSignal: opts.signal,
      // Provider payloads include non-standard fields on compatible gateways.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerOptions: providerOptions as any,
    })

    // Accumulators for assembling the final LLMResponse
    let textContent = ''
    let reasoningContent = ''
    const toolCallBuffers = new Map<string, { toolName: string; args: string }>()
    let stopReason: LLMResponse['stopReason'] = 'end_turn'

    const getPartText = (part: unknown): string => {
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      if (typeof record.delta === 'string') return record.delta
      return ''
    }
    const getPartId = (part: unknown): string | undefined => {
      if (!part || typeof part !== 'object') return undefined
      const record = part as Record<string, unknown>
      return typeof record.id === 'string' ? record.id : undefined
    }
    const parseToolInput = (input: unknown): Record<string, unknown> => {
      if (input && typeof input === 'object') return input as Record<string, unknown>
      if (typeof input === 'string') {
        try {
          const parsed = JSON.parse(input) as unknown
          if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
        } catch {
          return { input }
        }
      }
      return {}
    }

    for await (const part of res.fullStream) {
      const partType = (part as { type: string }).type
      this.#logVerbose('stream part', {
        type: partType,
        id: getPartId(part) ?? null,
        toolName: (part as { toolName?: string }).toolName ?? null,
      })

      // Skip lifecycle / metadata events
      if (
        partType === 'start' || partType === 'start-step'
        || partType === 'text-start' || partType === 'text-end'
        || partType === 'finish-step' || partType === 'stream-start'
        || partType === 'response-metadata' || partType === 'source'
        || partType === 'file' || partType === 'raw'
      ) continue

      if (partType === 'text-delta') {
        const delta = getPartText(part)
        if (delta) {
          textContent += delta
          onChunk({ type: 'text', content: delta })
        }
      } else if (partType === 'reasoning-start') {
        // no-op
      } else if (partType === 'reasoning-delta') {
        const delta = getPartText(part)
        if (delta) {
          reasoningContent += delta
          onChunk({ type: 'reasoning', content: delta })
        }
      } else if (partType === 'reasoning-end') {
        // no-op
      } else if (partType === 'tool-input-start') {
        const toolCallId = getPartId(part) ?? `tool_${nanoid(12)}`
        const toolName = (part as { toolName?: string }).toolName ?? 'unknown'
        toolCallBuffers.set(toolCallId, { toolName, args: '' })
        onChunk({ type: 'tool_call_start', toolCallId, toolName })
      } else if (partType === 'tool-input-delta') {
        const toolCallId = getPartId(part)
        if (toolCallId) {
          const delta = getPartText(part)
          if (!delta) continue
          const buffer = toolCallBuffers.get(toolCallId)
          if (buffer) {
            buffer.args += delta
            onChunk({ type: 'tool_call_delta', toolCallId, argumentsDelta: delta })
          } else {
            toolCallBuffers.set(toolCallId, { toolName: 'unknown', args: delta })
            onChunk({ type: 'tool_call_start', toolCallId, toolName: 'unknown' })
            onChunk({ type: 'tool_call_delta', toolCallId, argumentsDelta: delta })
          }
        }
      } else if (partType === 'tool-input-end') {
        const toolCallId = getPartId(part)
        if (toolCallId) onChunk({ type: 'tool_call_end', toolCallId })
      } else if (partType === 'tool-call') {
        const tc = part as { type: 'tool-call'; toolCallId?: string; toolName: string; args?: unknown; input?: unknown }
        const toolCallId = tc.toolCallId ?? `tool_${nanoid(12)}`
        const parsedInput = parseToolInput(tc.args ?? tc.input)
        const argsStr = JSON.stringify(parsedInput)
        toolCallBuffers.set(toolCallId, { toolName: tc.toolName, args: argsStr })
        onChunk({ type: 'tool_call_start', toolCallId, toolName: tc.toolName })
        onChunk({ type: 'tool_call_delta', toolCallId, argumentsDelta: argsStr })
        onChunk({ type: 'tool_call_end', toolCallId })
      } else if (partType === 'tool-result' || partType === 'tool-error') {
        const errorValue = (part as { error?: unknown }).error
        if (errorValue) throw errorValue instanceof Error ? errorValue : new Error(String(errorValue))
      } else if (partType === 'error') {
        const errorValue = (part as { error?: unknown }).error
        throw errorValue instanceof Error ? errorValue : new Error(String(errorValue ?? 'Stream error'))
      } else if (partType === 'finish') {
        const finishPart = part as { type: 'finish'; finishReason?: string }
        if (finishPart.finishReason === 'tool-calls') stopReason = 'tool_use'
        else if (finishPart.finishReason === 'length') stopReason = 'max_tokens'
        this.#logVerbose('stream finish', { finishReason: finishPart.finishReason ?? null, stopReason })
        onChunk({ type: 'done', stopReason })
      } else {
        console.warn(`Unknown stream part type: ${(part as { type: string }).type}`)
      }
    }

    const toolCalls: ToolCallRequest[] = []
    for (const [id, buffer] of toolCallBuffers) {
      try {
        toolCalls.push({
          toolCallId: id,
          toolName: buffer.toolName,
          arguments: JSON.parse(buffer.args) as Record<string, unknown>,
        })
      } catch {
        toolCalls.push({ toolCallId: id, toolName: buffer.toolName, arguments: {} })
      }
    }

    return {
      content: textContent || undefined,
      reasoning: reasoningContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason,
    }
  }
}
