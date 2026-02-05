import { generateText, streamText, type ModelMessage, type LanguageModel, AssistantModelMessage, TextPart, FilePart, ToolApprovalRequest, ToolCallPart, ToolResultPart } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { nanoid } from 'nanoid'
import type {
  LLMClient,
  LLMCompleteOptions,
  LLMMessage,
  LLMProfile,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamOptions
} from '../domain/ports/llmClient.js'
import type { ToolCallRequest } from '../domain/ports/tool.js'
import { convertToolDefinitionsToAISDKTools, type ToolSchemaStrategy } from './toolSchemaAdapter.js'
import { ReasoningPart } from '@ai-sdk/provider-utils'

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
              input: tc.arguments
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
            output: toToolResultOutput(m.content)
          }
        ]
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
    arguments: (tc.args ?? tc.input ?? {}) as Record<string, unknown>
  })) ?? []
}

export class OpenAILLMClient implements LLMClient {
  readonly #apiKey: string
  readonly #openai: ReturnType<typeof createOpenAICompatible>
  readonly #modelByProfile: Record<LLMProfile, string>
  readonly #toolSchemaStrategy: ToolSchemaStrategy
  readonly #verboseEnabled: boolean

  constructor(opts: {
    apiKey: string | null
    baseURL?: string | null
    modelByProfile: Record<LLMProfile, string>
    toolSchemaStrategy?: ToolSchemaStrategy
    verbose?: boolean
  }) {
    if (!opts.apiKey) {
      throw new Error('Missing COAUTHOR_OPENAI_API_KEY (or inject apiKey via config)')
    }
    this.#apiKey = opts.apiKey
    this.#openai = createOpenAICompatible({ 
      name: 'openai',
      apiKey: this.#apiKey, 
      baseURL: opts.baseURL ?? 'https://api.openai.com/v1',
    })
    this.#modelByProfile = opts.modelByProfile
    this.#toolSchemaStrategy = opts.toolSchemaStrategy ?? 'auto'
    const envVerbose = process.env.COAUTHOR_LLM_VERBOSE
    const envVerboseEnabled = envVerbose === '1' || envVerbose === 'true'
    this.#verboseEnabled = opts.verbose ?? envVerboseEnabled
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
    const modelId = this.#modelByProfile[opts.profile]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = convertToolDefinitionsToAISDKTools(opts.tools, this.#toolSchemaStrategy) as any

    this.#logVerbose('complete request', {
      profile: opts.profile,
      modelId,
      messagesCount: opts.messages.length,
      toolsCount: opts.tools?.length ?? 0,
      maxTokens: opts.maxTokens ?? null
    })
    
    const result = await generateText({
      model: this.#openai(modelId) as unknown as LanguageModel,
      messages: toModelMessages(opts.messages),
      tools,
      maxOutputTokens: opts.maxTokens,
    })

    // Convert tool calls to our format
    const toolCalls = toToolCallRequests(result.toolCalls)

    // Determine stop reason
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
      toolCallsCount: toolCalls.length
    })

    return {
      content: result.text || undefined,
      reasoning: result.reasoningText || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason
    }
  }

  async *stream(opts: LLMStreamOptions): AsyncGenerator<LLMStreamChunk> {
    const modelId = this.#modelByProfile[opts.profile]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = convertToolDefinitionsToAISDKTools(opts.tools, this.#toolSchemaStrategy) as any

    this.#logVerbose('stream request', {
      profile: opts.profile,
      modelId,
      messagesCount: opts.messages.length,
      toolsCount: opts.tools?.length ?? 0,
      maxTokens: opts.maxTokens ?? null
    })
    
    const res = await streamText({
      model: this.#openai(modelId) as unknown as LanguageModel,
      messages: toModelMessages(opts.messages),
      tools,
      maxOutputTokens: opts.maxTokens,
      providerOptions: {
        openai: {
          enable_thinking: false
        }
      }
    })

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
      if (input && typeof input === 'object') {
        return input as Record<string, unknown>
      }
      if (typeof input === 'string') {
        try {
          const parsed = JSON.parse(input) as unknown
          if (parsed && typeof parsed === 'object') {
            return parsed as Record<string, unknown>
          }
        } catch {
          return { input }
        }
      }
      return {}
    }
    const reasoningBuffers = new Map<string, string>()
    const toolInputBuffers = new Map<string, { toolName: string; input: string }>()
    
    for await (const part of res.fullStream) {
      const partType = (part as { type: string }).type
      this.#logVerbose('stream part', {
        type: partType,
        id: getPartId(part) ?? null,
        toolName: (part as { toolName?: string }).toolName ?? null
      })
      if (
        partType === 'start' ||
        partType === 'start-step' ||
        partType === 'text-start' ||
        partType === 'text-end' ||
        partType === 'finish-step' ||
        partType === 'stream-start' ||
        partType === 'response-metadata' ||
        partType === 'source' ||
        partType === 'file' ||
        partType === 'raw'
      ) {
        continue
      }
      if (partType === 'text-delta') {
        const textDelta = getPartText(part)
        if (textDelta) {
          this.#logVerbose('text-delta', { length: textDelta.length })
          yield { type: 'text', content: textDelta }
        }
      } else if (partType === 'reasoning-start') {
        const reasoningId = getPartId(part) ?? `reasoning_${nanoid(10)}`
        reasoningBuffers.set(reasoningId, '')
      } else if (partType === 'reasoning-delta') {
        const reasoningId = getPartId(part)
        const delta = getPartText(part)
        if (reasoningId && delta) {
          const existing = reasoningBuffers.get(reasoningId) ?? ''
          reasoningBuffers.set(reasoningId, existing + delta)
          this.#logVerbose('reasoning-delta', { id: reasoningId, length: delta.length })
          yield { type: 'reasoning', content: delta }
        }
      } else if (partType === 'reasoning-end') {
        const reasoningId = getPartId(part)
        if (reasoningId) {
          reasoningBuffers.delete(reasoningId)
        }
      } else if (partType === 'tool-input-start') {
        const toolInputId = getPartId(part) ?? `tool_${nanoid(12)}`
        const toolName = (part as { toolName?: string }).toolName ?? 'unknown'
        toolInputBuffers.set(toolInputId, { toolName, input: '' })
        this.#logVerbose('tool-input-start', { toolCallId: toolInputId, toolName })
        yield { type: 'tool_call_start', toolCallId: toolInputId, toolName }
      } else if (partType === 'tool-input-delta') {
        const toolInputId = getPartId(part)
        if (toolInputId) {
          const delta = getPartText(part)
          if (!delta) continue

          const existing = toolInputBuffers.get(toolInputId)
          if (existing) {
            toolInputBuffers.set(toolInputId, { toolName: existing.toolName, input: existing.input + delta })
            this.#logVerbose('tool-input-delta', { toolCallId: toolInputId, delta })
            yield { type: 'tool_call_delta', toolCallId: toolInputId, argumentsDelta: delta }
            continue
          }

          toolInputBuffers.set(toolInputId, { toolName: 'unknown', input: delta })
          this.#logVerbose('tool-input-delta', { toolCallId: toolInputId, delta })
          yield { type: 'tool_call_start', toolCallId: toolInputId, toolName: 'unknown' }
          yield { type: 'tool_call_delta', toolCallId: toolInputId, argumentsDelta: delta }
        }
      } else if (partType === 'tool-input-end') {
        const toolInputId = getPartId(part)
        if (toolInputId) {
          this.#logVerbose('tool-input-end', { toolCallId: toolInputId })
          yield { type: 'tool_call_end', toolCallId: toolInputId }
          toolInputBuffers.delete(toolInputId)
        }
      } else if (partType === 'tool-call') {
        const toolCallPart = part as { type: 'tool-call'; toolCallId?: string; toolName: string; args?: unknown; input?: unknown }
        const toolCallId = toolCallPart.toolCallId ?? `tool_${nanoid(12)}`
        const parsedInput = parseToolInput(toolCallPart.args ?? toolCallPart.input)
        this.#logVerbose('tool-call', { toolCallId, toolName: toolCallPart.toolName })
        yield { type: 'tool_call_start', toolCallId, toolName: toolCallPart.toolName }
        yield { type: 'tool_call_delta', toolCallId, argumentsDelta: JSON.stringify(parsedInput) }
        yield { type: 'tool_call_end', toolCallId }
      } else if (partType === 'tool-result' || partType === 'tool-error') {
        const errorValue = (part as { error?: unknown }).error
        if (errorValue) {
          throw errorValue instanceof Error ? errorValue : new Error(String(errorValue))
        }
      } else if (partType === 'error') {
        const errorValue = (part as { error?: unknown }).error
        throw errorValue instanceof Error ? errorValue : new Error(String(errorValue ?? 'Stream error'))
      } else if (partType === 'finish') {
        const finishPart = part as { type: 'finish'; finishReason?: string }
        let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn'
        if (finishPart.finishReason === 'tool-calls') {
          stopReason = 'tool_use'
        } else if (finishPart.finishReason === 'length') {
          stopReason = 'max_tokens'
        }
        this.#logVerbose('stream finish', { finishReason: finishPart.finishReason ?? null, stopReason })
        yield { type: 'done', stopReason }
      } else {
        console.warn(`Unknown stream part type: ${(part as { type: string }).type}`)
      }
    }
  }
}
