import type {
  LLMClient,
  LLMCompleteOptions,
  LLMMessage,
  LLMProfile,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamOptions
} from '../domain/ports/llmClient.js'

export type FakeLLMRule = {
  whenIncludes: string
  returns: string | LLMResponse
}

function toFlatText(messages: LLMMessage[]): string {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return `[tool:${m.toolCallId}] ${m.content}`
    }
    if (m.role === 'assistant' && m.toolCalls) {
      return `[assistant] ${m.content ?? ''} [tools: ${m.toolCalls.map(tc => tc.toolName).join(', ')}]`
    }
    return `[${m.role}] ${'content' in m ? m.content : ''}`
  }).join('\n')
}

export class FakeLLMClient implements LLMClient {
  readonly label = 'Fake'
  readonly description = 'Rule-based mock LLM for testing'
  readonly #rules: FakeLLMRule[]
  readonly #defaultByProfile: Record<LLMProfile, LLMResponse>

  constructor(opts?: { rules?: FakeLLMRule[]; defaultByProfile?: Partial<Record<LLMProfile, string | LLMResponse>> }) {
    this.#rules = opts?.rules ?? []
    
    const toResponse = (val: string | LLMResponse | undefined, fallback: string): LLMResponse => {
      if (!val) return { content: fallback, stopReason: 'end_turn' }
      if (typeof val === 'string') return { content: val, stopReason: 'end_turn' }
      return val
    }

    this.#defaultByProfile = {
      fast: toResponse(opts?.defaultByProfile?.fast, FakeLLMClient.defaultResponse()),
      writer: toResponse(opts?.defaultByProfile?.writer, FakeLLMClient.defaultResponse()),
      reasoning: toResponse(opts?.defaultByProfile?.reasoning, FakeLLMClient.defaultResponse())
    }
  }

  async complete(opts: LLMCompleteOptions): Promise<LLMResponse> {
    const text = toFlatText(opts.messages)
    const hit = this.#rules.find((r) => text.includes(r.whenIncludes))
    
    if (hit) {
      if (typeof hit.returns === 'string') {
        return { content: hit.returns, stopReason: 'end_turn' }
      }
      return hit.returns
    }
    
    return this.#defaultByProfile[opts.profile]
  }

  async stream(opts: LLMStreamOptions, onChunk?: (chunk: LLMStreamChunk) => void): Promise<LLMResponse> {
    const response = await this.complete(opts)

    if (onChunk) {
      if (response.reasoning) {
        onChunk({ type: 'reasoning', content: response.reasoning })
      }
      if (response.content) {
        onChunk({ type: 'text', content: response.content })
      }
      if (response.toolCalls) {
        for (const tc of response.toolCalls) {
          onChunk({ type: 'tool_call_start', toolCallId: tc.toolCallId, toolName: tc.toolName })
          onChunk({ type: 'tool_call_delta', toolCallId: tc.toolCallId, argumentsDelta: JSON.stringify(tc.arguments) })
          onChunk({ type: 'tool_call_end', toolCallId: tc.toolCallId })
        }
      }
      onChunk({ type: 'done', stopReason: response.stopReason })
    }

    return response
  }

  static defaultResponse(): string {
    return 'Task acknowledged. Ready to proceed.'
  }
}


