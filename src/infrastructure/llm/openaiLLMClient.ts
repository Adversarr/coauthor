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
} from '../../config/llmProfileCatalog.js'
import {
  buildOpenAICompatibleProviderOptions,
  providerDefaultBaseURL,
  type OpenAICompatibleProvider,
} from './openaiProviderOptions.js'
import {
  getStreamPartField,
  getStreamPartId,
  getStreamPartText,
  getStreamPartToolName,
  getStreamPartType,
  getStreamToolCallId,
  isIgnoredStreamPartType,
  parseStreamToolInput,
  type StreamToolCallBuffer,
} from './streamPartParsers.js'

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

export class OpenAILLMClient implements LLMClient {
  readonly provider: OpenAICompatibleProvider
  readonly label: string
  readonly description: string
  readonly profileCatalog: LLMProfileCatalog
  readonly #openai: ReturnType<typeof createOpenAICompatible>
  readonly #toolSchemaStrategy: ToolSchemaStrategy
  readonly #verboseEnabled: boolean
  readonly #profileCatalogConfig: LLMProfileCatalogConfig

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

  #buildProviderOptions(input: { policy: ClientPolicy }): ReturnType<typeof buildOpenAICompatibleProviderOptions> {
    return buildOpenAICompatibleProviderOptions({
      provider: this.provider,
      policy: input.policy,
    })
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
    const tools = convertToolDefinitionsToAISDKTools(opts.tools, this.#toolSchemaStrategy)
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
      providerOptions,
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
    const tools = convertToolDefinitionsToAISDKTools(opts.tools, this.#toolSchemaStrategy)
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
      providerOptions,
    })

    // Accumulators for assembling the final LLMResponse
    let textContent = ''
    let reasoningContent = ''
    const toolCallBuffers = new Map<string, StreamToolCallBuffer>()
    let stopReason: LLMResponse['stopReason'] = 'end_turn'

    for await (const part of res.fullStream) {
      const partType = getStreamPartType(part)
      this.#logVerbose('stream part', {
        type: partType ?? 'unknown',
        id: getStreamPartId(part) ?? null,
        toolName: getStreamPartToolName(part) ?? null,
      })

      if (!partType) continue

      // Skip lifecycle / metadata events
      if (isIgnoredStreamPartType(partType)) continue

      if (partType === 'text-delta') {
        const delta = getStreamPartText(part)
        if (delta) {
          textContent += delta
          onChunk({ type: 'text', content: delta })
        }
      } else if (partType === 'reasoning-start') {
        // no-op
      } else if (partType === 'reasoning-delta') {
        const delta = getStreamPartText(part)
        if (delta) {
          reasoningContent += delta
          onChunk({ type: 'reasoning', content: delta })
        }
      } else if (partType === 'reasoning-end') {
        // no-op
      } else if (partType === 'tool-input-start') {
        const toolCallId = getStreamPartId(part) ?? `tool_${nanoid(12)}`
        const toolName = getStreamPartToolName(part) ?? 'unknown'
        toolCallBuffers.set(toolCallId, { toolName, args: '' })
        onChunk({ type: 'tool_call_start', toolCallId, toolName })
      } else if (partType === 'tool-input-delta') {
        const toolCallId = getStreamPartId(part)
        if (toolCallId) {
          const delta = getStreamPartText(part)
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
        const toolCallId = getStreamPartId(part)
        if (toolCallId) onChunk({ type: 'tool_call_end', toolCallId })
      } else if (partType === 'tool-call') {
        const toolCallId = getStreamToolCallId(part) ?? `tool_${nanoid(12)}`
        const toolName = getStreamPartToolName(part) ?? 'unknown'
        const parsedInput = parseStreamToolInput(getStreamPartField(part, 'args') ?? getStreamPartField(part, 'input'))
        const argsStr = JSON.stringify(parsedInput)
        toolCallBuffers.set(toolCallId, { toolName, args: argsStr })
        onChunk({ type: 'tool_call_start', toolCallId, toolName })
        onChunk({ type: 'tool_call_delta', toolCallId, argumentsDelta: argsStr })
        onChunk({ type: 'tool_call_end', toolCallId })
      } else if (partType === 'tool-result' || partType === 'tool-error') {
        const errorValue = getStreamPartField(part, 'error')
        if (errorValue) throw errorValue instanceof Error ? errorValue : new Error(String(errorValue))
      } else if (partType === 'error') {
        const errorValue = getStreamPartField(part, 'error')
        throw errorValue instanceof Error ? errorValue : new Error(String(errorValue ?? 'Stream error'))
      } else if (partType === 'finish') {
        const finishReason = getStreamPartField(part, 'finishReason')
        if (finishReason === 'tool-calls') stopReason = 'tool_use'
        else if (finishReason === 'length') stopReason = 'max_tokens'
        this.#logVerbose('stream finish', {
          finishReason: typeof finishReason === 'string' ? finishReason : null,
          stopReason,
        })
        onChunk({ type: 'done', stopReason })
      } else {
        console.warn(`Unknown stream part type: ${partType}`)
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
