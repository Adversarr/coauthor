import type { Subscribable } from './subscribable.js'
import type { StoredAuditEntry } from './auditLog.js'

export type UiEvent =
  | {
      type: 'agent_output'
      payload: { taskId: string; agentId: string; kind: 'text' | 'reasoning' | 'verbose' | 'error'; content: string }
    }
  | {
      type: 'stream_delta'
      payload: { taskId: string; agentId: string; kind: 'text' | 'reasoning'; content: string }
    }
  | {
      type: 'stream_end'
      payload: { taskId: string; agentId: string }
    }
  | {
      type: 'tool_call_start'
      payload: { taskId: string; agentId: string; toolCallId: string; toolName: string; arguments: Record<string, unknown> }
    }
  | {
      type: 'tool_call_end'
      payload: { taskId: string; agentId: string; toolCallId: string; toolName: string; output: unknown; isError: boolean; durationMs: number }
    }
  | {
      type: 'audit_entry'
      payload: StoredAuditEntry
    }

export interface UiBus {
  readonly events$: Subscribable<UiEvent>
  emit(event: UiEvent): void
}
