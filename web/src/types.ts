/**
 * Shared types mirroring the backend domain.
 * These are plain TS types — no Zod dependency on the frontend.
 */

// ── Task ───────────────────────────────────────────────────────────────

export type TaskStatus = 'open' | 'in_progress' | 'awaiting_user' | 'paused' | 'done' | 'failed' | 'canceled'
export type TaskPriority = 'foreground' | 'normal' | 'background'
export type TaskTodoStatus = 'pending' | 'completed'

export interface TaskTodoItem {
  id: string
  title: string
  description?: string
  status: TaskTodoStatus
}

export interface TaskView {
  taskId: string
  title: string
  intent: string
  createdBy: string
  agentId: string
  priority: TaskPriority
  status: TaskStatus
  pendingInteractionId?: string
  lastInteractionId?: string
  parentTaskId?: string
  childTaskIds?: string[]
  todos?: TaskTodoItem[]
  summary?: string
  failureReason?: string
  createdAt: string
  updatedAt: string
}

// ── Events ─────────────────────────────────────────────────────────────

export type EventType =
  | 'TaskCreated' | 'TaskStarted' | 'TaskCompleted' | 'TaskFailed'
  | 'TaskCanceled' | 'TaskPaused' | 'TaskResumed' | 'TaskInstructionAdded'
  | 'TaskTodoUpdated'
  | 'UserInteractionRequested' | 'UserInteractionResponded'

export interface StoredEvent {
  id: number
  streamId: string
  seq: number
  type: EventType
  payload: Record<string, unknown>
  createdAt: string
}

// ── UiEvent (streaming) ────────────────────────────────────────────────

export type UiEvent =
  | { type: 'agent_output'; payload: { taskId: string; agentId: string; kind: 'text' | 'reasoning' | 'verbose' | 'error'; content: string } }
  | { type: 'stream_delta'; payload: { taskId: string; agentId: string; kind: 'text' | 'reasoning'; content: string } }
  | { type: 'stream_end'; payload: { taskId: string; agentId: string } }
  | { type: 'tool_call_start'; payload: { taskId: string; agentId: string; toolCallId: string; toolName: string; arguments: Record<string, unknown> } }
  | { type: 'tool_call_end'; payload: { taskId: string; agentId: string; toolCallId: string; toolName: string; output: unknown; isError: boolean; durationMs: number } }
  | { type: 'tool_call_heartbeat'; payload: { taskId: string; agentId: string; toolCallId: string; toolName: string; elapsedMs: number } }
  | { type: 'tool_calls_batch_start'; payload: { taskId: string; agentId: string; count: number; safeCount: number; riskyCount: number } }
  | { type: 'tool_calls_batch_end'; payload: { taskId: string; agentId: string } }
  | { type: 'audit_entry'; payload: Record<string, unknown> }

// ── Interaction ────────────────────────────────────────────────────────

export interface InteractionOption {
  id: string
  label: string
  style?: 'primary' | 'danger' | 'default'
  isDefault?: boolean
}

export interface InteractionDisplay {
  title: string
  description?: string
  content?: unknown
  contentKind?: 'PlainText' | 'Json' | 'Diff' | 'Table'
  metadata?: Record<string, string>
}

export interface PendingInteraction {
  interactionId: string
  taskId: string
  kind: 'Select' | 'Confirm' | 'Input' | 'Composite'
  purpose: string
  display: InteractionDisplay
  options?: InteractionOption[]
}

// ── WebSocket Protocol ─────────────────────────────────────────────────

export type WsClientMessage =
  | { type: 'subscribe'; channels: ('events' | 'ui')[]; streamId?: string; lastEventId?: number }
  | { type: 'unsubscribe'; channels: ('events' | 'ui')[] }
  | { type: 'ping' }

export type WsServerMessage =
  | { type: 'event'; data: StoredEvent }
  | { type: 'ui_event'; data: UiEvent }
  | { type: 'subscribed'; channels: string[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' }

// ── API Responses ──────────────────────────────────────────────────────

export interface CreateTaskResponse { taskId: string }
export interface CreateTaskGroupTaskInput {
  agentId: string
  title: string
  intent?: string
  priority?: TaskPriority
}
export interface CreateTaskGroupResponse {
  groupId: string
  tasks: Array<{ taskId: string; agentId: string; title: string }>
}
export interface HealthResponse { status: string; uptime: number }

export interface RuntimeLLMProfile {
  id: string
  model: string
  clientPolicy: string
  builtin: boolean
}

export interface RuntimeInfo {
  agents: Array<{ id: string; displayName: string; description: string }>
  defaultAgentId: string
  streamingEnabled: boolean
  llm: {
    provider: 'fake' | 'openai' | 'bailian' | 'volcengine'
    defaultProfile: string
    profiles: RuntimeLLMProfile[]
    globalProfileOverride: string | null
  }
}

// ── LLM Conversation ───────────────────────────────────────────────────

export interface ToolCallRequest {
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
}

export type LLMMessagePart =
  | { kind: 'text'; content: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'tool_call'; toolCallId: string; toolName: string; arguments: Record<string, unknown> }

export type LLMMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: ToolCallRequest[]; reasoning?: string; parts?: LLMMessagePart[] }
  | { role: 'tool'; toolCallId: string; content: string; toolName?: string }
