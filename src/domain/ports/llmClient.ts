import type { ToolDefinition, ToolCallRequest } from './tool.js'

export type LLMProfile = 'fast' | 'writer' | 'reasoning'

export type LLMMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: ToolCallRequest[]; reasoning?: string }
  | { role: 'tool'; toolCallId: string; content: string; toolName?: string }

// ============================================================================
// LLM Response Types
// ============================================================================

export type LLMStopReason = 'end_turn' | 'tool_use' | 'max_tokens'

export type LLMResponse = {
  content?: string
  reasoning?: string
  toolCalls?: ToolCallRequest[]
  stopReason: LLMStopReason
}

// ============================================================================
// LLM Options
// ============================================================================

export type LLMCompleteOptions = {
  profile: LLMProfile
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  maxTokens?: number
}

export type LLMStreamOptions = {
  profile: LLMProfile
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  maxTokens?: number
}

// ============================================================================
// LLM Stream Chunk Types
// ============================================================================

export type LLMStreamChunk =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string }
  | { type: 'tool_call_delta'; toolCallId: string; argumentsDelta: string }
  | { type: 'tool_call_end'; toolCallId: string }
  | { type: 'done'; stopReason: LLMStopReason }

// ============================================================================
// LLM Client Interface
// ============================================================================

export interface LLMClient {
  /**
   * Complete a conversation (non-streaming).
   * Returns structured response with content and/or tool calls.
   */
  complete(opts: LLMCompleteOptions): Promise<LLMResponse>

  /**
   * Stream a conversation.
   * Yields chunks for text and tool calls.
   */
  stream(opts: LLMStreamOptions): AsyncGenerator<LLMStreamChunk>
}
