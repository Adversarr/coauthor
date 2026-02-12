import type { ToolDefinition, ToolCallRequest } from './tool.js'

export type LLMProfile = 'fast' | 'writer' | 'reasoning'

export type LLMMessagePart =
  | { kind: 'text'; content: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'tool_call'; toolCallId: string; toolName: string; arguments: Record<string, unknown> }

export type LLMMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: ToolCallRequest[]; reasoning?: string; parts?: LLMMessagePart[] }
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
  signal?: AbortSignal
}

export type LLMStreamOptions = {
  profile: LLMProfile
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  maxTokens?: number
  signal?: AbortSignal
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
  /** Human-readable label, e.g. 'OpenAI' */
  readonly label: string

  /** Short description of the client configuration */
  readonly description: string

  /**
   * Complete a conversation (non-streaming).
   * Returns structured response with content and/or tool calls.
   */
  complete(opts: LLMCompleteOptions): Promise<LLMResponse>

  /**
   * Stream a conversation with optional per-chunk callback.
   *
   * When `onChunk` is provided, the implementation SHOULD use streaming
   * internally and invoke the callback for each incremental chunk.
   * When `onChunk` is omitted, the implementation MAY delegate to
   * `complete()` for efficiency (no streaming overhead).
   *
   * Returns the same `LLMResponse` as `complete()`, making them
   * interchangeable from the caller's perspective.
   */
  stream(opts: LLMStreamOptions, onChunk?: (chunk: LLMStreamChunk) => void): Promise<LLMResponse>
}
