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

function defaultProfileCatalog(): LLMProfileCatalog {
  return {
    defaultProfile: 'fast',
    profiles: [
      { id: 'fast', model: 'fake-fast', clientPolicy: 'default', builtin: true },
      { id: 'writer', model: 'fake-writer', clientPolicy: 'default', builtin: true },
      { id: 'reasoning', model: 'fake-reasoning', clientPolicy: 'default', builtin: true },
    ],
  }
}

export class FakeLLMClient implements LLMClient {
  readonly provider = 'fake' as const
  readonly label = 'Fake'
  readonly description = 'Rule-based mock LLM for testing'
  readonly profileCatalog: LLMProfileCatalog
  readonly #rules: FakeLLMRule[]
  readonly #defaultByProfile: Record<LLMProfile, LLMResponse>

  constructor(opts?: {
    rules?: FakeLLMRule[]
    defaultByProfile?: Record<string, string | LLMResponse>
    profileCatalog?: LLMProfileCatalog
  }) {
    this.#rules = opts?.rules ?? []
    this.profileCatalog = opts?.profileCatalog ?? defaultProfileCatalog()

    const toResponse = (value: string | LLMResponse | undefined, fallback: string): LLMResponse => {
      if (!value) return { content: fallback, stopReason: 'end_turn' }
      if (typeof value === 'string') return { content: value, stopReason: 'end_turn' }
      return value
    }

    const defaults: Record<LLMProfile, LLMResponse> = {}
    for (const profile of this.profileCatalog.profiles) {
      defaults[profile.id] = toResponse(
        opts?.defaultByProfile?.[profile.id],
        FakeLLMClient.defaultResponse(),
      )
    }

    if (!defaults[this.profileCatalog.defaultProfile]) {
      defaults[this.profileCatalog.defaultProfile] = {
        content: FakeLLMClient.defaultResponse(),
        stopReason: 'end_turn',
      }
    }

    this.#defaultByProfile = defaults
  }

  async complete(opts: LLMCompleteOptions): Promise<LLMResponse> {
    const text = toFlatText(opts.messages)
    const hit = this.#rules.find((rule) => text.includes(rule.whenIncludes))

    if (hit) {
      if (typeof hit.returns === 'string') {
        return { content: hit.returns, stopReason: 'end_turn' }
      }
      return hit.returns
    }

    return this.#defaultByProfile[opts.profile] ?? this.#defaultByProfile[this.profileCatalog.defaultProfile]
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
