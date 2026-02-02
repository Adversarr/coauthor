import type { LLMClient, LLMCompleteOptions, LLMMessage, LLMProfile, LLMStreamOptions } from '../domain/ports/llmClient.js'

export type FakeLLMRule = {
  whenIncludes: string
  returns: string
}

function toFlatText(messages: LLMMessage[]): string {
  return messages.map((m) => `[${m.role}] ${m.content}`).join('\n')
}

export class FakeLLMClient implements LLMClient {
  readonly #rules: FakeLLMRule[]
  readonly #defaultByProfile: Record<LLMProfile, string>

  constructor(opts?: { rules?: FakeLLMRule[]; defaultByProfile?: Partial<Record<LLMProfile, string>> }) {
    this.#rules = opts?.rules ?? []
    this.#defaultByProfile = {
      fast: opts?.defaultByProfile?.fast ?? FakeLLMClient.defaultPlanJson(),
      writer: opts?.defaultByProfile?.writer ?? FakeLLMClient.defaultPlanJson(),
      reasoning: opts?.defaultByProfile?.reasoning ?? FakeLLMClient.defaultPlanJson()
    }
  }

  async complete(opts: LLMCompleteOptions): Promise<string> {
    const text = toFlatText(opts.messages)
    const hit = this.#rules.find((r) => text.includes(r.whenIncludes))
    return hit ? hit.returns : this.#defaultByProfile[opts.profile]
  }

  async *stream(opts: LLMStreamOptions): AsyncGenerator<string> {
    yield await this.complete(opts)
  }

  static defaultPlanJson(): string {
    return JSON.stringify(
      {
        goal: 'Generate an execution plan',
        strategy: 'Use deterministic fake LLM output for stable tests',
        scope: 'M1 preparation stage',
        issues: [],
        risks: [],
        questions: []
      },
      null,
      2
    )
  }
}

