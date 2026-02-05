import { generateText, streamText, type ModelMessage, type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
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
import type { ToolDefinition, ToolCallRequest } from '../domain/ports/tool.js'

// Convert our LLMMessage to ai-sdk ModelMessage format
function toModelMessages(messages: LLMMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === 'system') {
      return { role: 'system', content: m.content }
    }
    if (m.role === 'user') {
      return { role: 'user', content: m.content }
    }
    if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length > 0) {
        // Build content parts for assistant with tool calls
        const parts: Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }> = []
        if (m.content) {
          parts.push({ type: 'text', text: m.content })
        }
        for (const tc of m.toolCalls) {
          parts.push({
            type: 'tool-call',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.arguments
          })
        }
        return { role: 'assistant', content: parts } as ModelMessage
      }
      return { role: 'assistant', content: m.content ?? '' }
    }
    if (m.role === 'tool') {
      // Use 'as unknown as ModelMessage' to work around ai-sdk type changes
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: m.toolCallId,
            toolName: 'unknown',
            output: { text: m.content }
          }
        ]
      } as unknown as ModelMessage
    }
    throw new Error(`Unknown message role: ${(m as { role: string }).role}`)
  })
}

// Convert our ToolDefinition to ai-sdk Tool format
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCoreTools(tools?: ToolDefinition[]): Record<string, any> | undefined {
  if (!tools || tools.length === 0) return undefined
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {}
  for (const t of tools) {
    result[t.name] = {
      description: t.description,
      inputSchema: jsonSchemaToZod(t.parameters)
    }
  }
  return result
}

// Convert ai-sdk tool calls to our ToolCallRequest format
export function toToolCallRequests(toolCalls?: Array<{ toolCallId?: string; toolName: string; args?: unknown }>): ToolCallRequest[] {
  return toolCalls?.map((tc) => ({
    toolCallId: tc.toolCallId ?? `tool_${nanoid(12)}`,
    toolName: tc.toolName,
    arguments: (tc.args ?? {}) as Record<string, unknown>
  })) ?? []
}

// Simple JSON Schema to Zod converter (covers basic cases)
function jsonSchemaToZod(schema: ToolDefinition['parameters']): z.ZodType {
  const shape: Record<string, z.ZodType> = {}
  
  for (const [key, prop] of Object.entries(schema.properties)) {
    let zodType: z.ZodType
    
    switch (prop.type) {
      case 'string':
        zodType = (prop.enum && prop.enum.length > 0) ? z.enum(prop.enum as [string, ...string[]]) : z.string()
        break
      case 'number':
        zodType = z.number()
        break
      case 'boolean':
        zodType = z.boolean()
        break
      case 'array':
        zodType = z.array(z.unknown())
        break
      case 'object':
        zodType = z.record(z.unknown())
        break
      default:
        zodType = z.unknown()
    }
    
    if (prop.description) {
      zodType = zodType.describe(prop.description)
    }
    
    // Make optional if not in required
    if (!schema.required?.includes(key)) {
      zodType = zodType.optional()
    }
    
    shape[key] = zodType
  }
  
  return z.object(shape)
}

export class OpenAILLMClient implements LLMClient {
  readonly #apiKey: string
  readonly #openai: ReturnType<typeof createOpenAICompatible>
  readonly #modelByProfile: Record<LLMProfile, string>

  constructor(opts: {
    apiKey: string | null
    baseURL?: string | null
    modelByProfile: Record<LLMProfile, string>
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
  }

  async complete(opts: LLMCompleteOptions): Promise<LLMResponse> {
    const modelId = this.#modelByProfile[opts.profile]
    const tools = toCoreTools(opts.tools)
    
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

    return {
      content: result.text || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason
    }
  }

  async *stream(opts: LLMStreamOptions): AsyncGenerator<LLMStreamChunk> {
    const modelId = this.#modelByProfile[opts.profile]
    const tools = toCoreTools(opts.tools)
    
    const res = await streamText({
      model: this.#openai(modelId) as unknown as LanguageModel,
      messages: toModelMessages(opts.messages),
      tools,
      maxOutputTokens: opts.maxTokens,
      providerOptions: {
        openai: {
          enable_thinking: true
        }
      }
    })

    // Track reasoning and tool calls being built
    let reasoningBuffer = ''
    
    for await (const part of res.fullStream) {
      if (part.type === 'text-delta') {
        yield { type: 'text', content: part.text }
      } else if (part.type === 'reasoning-start') {
        reasoningBuffer = ''
      } else if (part.type === 'reasoning-delta') {
        const delta = part.text
        reasoningBuffer += delta
      } else if (part.type === 'reasoning-end') {
        if (reasoningBuffer) {
          yield { type: 'reasoning', content: reasoningBuffer }
        }
        reasoningBuffer = ''
      } else if (part.type === 'tool-call') {
        const toolCallPart = part as { type: 'tool-call'; toolCallId?: string; toolName: string; args?: unknown; input?: unknown }
        const toolCallId = toolCallPart.toolCallId ?? `tool_${nanoid(12)}`
        yield { type: 'tool_call_start', toolCallId, toolName: toolCallPart.toolName }
        yield { type: 'tool_call_delta', toolCallId, argumentsDelta: JSON.stringify(toolCallPart.args ?? toolCallPart.input ?? {}) }
        yield { type: 'tool_call_end', toolCallId }
      } else if (part.type === 'finish') {
        const finishPart = part as { type: 'finish'; finishReason?: string }
        let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn'
        if (finishPart.finishReason === 'tool-calls') {
          stopReason = 'tool_use'
        } else if (finishPart.finishReason === 'length') {
          stopReason = 'max_tokens'
        }
        yield { type: 'done', stopReason }
      } else {
        console.warn(`Unknown stream part type: ${(part as { type: string }).type}`)
      }
    }
  }
}

