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
      type: 'audit_entry'
      payload: StoredAuditEntry
    }

export interface UiBus {
  readonly events$: Subscribable<UiEvent>
  emit(event: UiEvent): void
}
