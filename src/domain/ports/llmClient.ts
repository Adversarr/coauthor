export type LLMProfile = 'fast' | 'writer' | 'reasoning'

export type LLMMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LLMCompleteOptions = {
  profile: LLMProfile
  messages: LLMMessage[]
  maxTokens?: number
}

export type LLMStreamOptions = {
  profile: LLMProfile
  messages: LLMMessage[]
  maxTokens?: number
}

export interface LLMClient {
  complete(opts: LLMCompleteOptions): Promise<string>
  stream(opts: LLMStreamOptions): AsyncGenerator<string>
}

