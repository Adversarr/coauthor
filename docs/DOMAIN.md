# CoAuthor Domain Model Specification

> Version: V0.1  
> Last Updated: 2026-02-03  
> Status: Normative

This document defines the domain model for CoAuthor: Event Schema, Entity definitions, and Policy rules. All code implementations must remain consistent with this document.

This specification has been updated according to the direction reset in [ARCHITECTURE_DISCUSSION_2026-02-03.md](ARCHITECTURE_DISCUSSION_2026-02-03.md): DomainEvents only express the Task lifecycle and general interactions (UIP); tool calls and their results are recorded in a separate AuditLog and are not expressed via Plan/Patch events.

---

## V0/V1 Feature Boundaries

| Feature | V0 Status | V1 Plan |
|------|---------|---------|
| Task Lifecycle Events | ✅ 5 types (Created/Started/Completed/Failed/Canceled) | Possible addition of Claim/Subtask events |
| UIP General Interaction | ✅ Fully implemented | - |
| Tool Use + AuditLog | ✅ Fully implemented | - |
| ConversationStore | ✅ Persistence of conversation history | - |
| Risky Tool Confirmation | ✅ Mandatory check by ToolExecutor | - |
| Task Assignment | agentId specified directly upon creation | Multi-Agent routing (TBD) |
| Subtasks | Schema reserves parentTaskId | Full Orchestrator implementation |
| InteractionPurpose.assign_subtask | Defined but not used | Used by Orchestrator |
| ArtifactStore Port | TODO (directly using fs API) | Full Port implementation |

---

## 1. Event Schema

### 1.1 Design Principles

- **Append-only**: Events can only be appended, not modified or deleted.
- **Self-describing**: Each event contains sufficient information for auditing and replay.
- **Zod Validation**: All events are defined and validated using Zod schemas.
- **authorActorId**: Every event must record who triggered it.

### 1.2 StoredEvent

```typescript
type StoredEvent = DomainEvent & {
  id: number          // Global auto-increment ID
  streamId: string    // Usually taskId
  seq: number         // Sequence number within the stream
  createdAt: string   // ISO timestamp
}
```

### 1.3 DomainEvent Definition

#### 1.3.1 Task Lifecycle Events

```typescript
// Task Creation
type TaskCreatedEvent = {
  type: 'TaskCreated'
  payload: {
    taskId: string
    title: string
    intent: string                    // Original user intent
    priority: 'foreground' | 'normal' | 'background'
    agentId: string                   // Designated processing Agent
    artifactRefs?: ArtifactRef[]      // Associated files/locations
    authorActorId: string             // Who created it (usually user)
  }
}

// Task Execution Started
type TaskStartedEvent = {
  type: 'TaskStarted'
  payload: {
    taskId: string
    agentId: string                   // Agent executing the task
    authorActorId: string
  }
}

// Task Completed
type TaskCompletedEvent = {
  type: 'TaskCompleted'
  payload: {
    taskId: string
    summary?: string                  // Completion summary
    authorActorId: string
  }
}

// Task Failed
type TaskFailedEvent = {
  type: 'TaskFailed'
  payload: {
    taskId: string
    reason: string
    authorActorId: string
  }
}

// Task Canceled
type TaskCanceledEvent = {
  type: 'TaskCanceled'
  payload: {
    taskId: string
    reason?: string
    authorActorId: string
  }
}
```

> **V0.1 Note**: Plan/Patch events are no longer used to express the collaboration process; stages such as "waiting for user confirmation/supplementary information" are unified under UIP.

#### 1.3.2 General Interaction Events (UIP)

```typescript
type UserInteractionRequestedEvent = {
  type: 'UserInteractionRequested'
  payload: {
    interactionId: string
    taskId: string
    authorActorId: string

    kind: 'Select' | 'Confirm' | 'Input' | 'Composite'

    purpose:
      | 'choose_strategy'
      | 'request_info'
      | 'confirm_risky_action'
      | 'assign_subtask'
      | 'generic'

    display: {
      title: string
      description?: string
      content?: unknown
      contentKind?: 'PlainText' | 'Json' | 'Diff' | 'Table'
    }

    options?: Array<{
      id: string
      label: string
      style?: 'primary' | 'danger' | 'default'
      isDefault?: boolean
    }>

    validation?: {
      regex?: string
      required?: boolean
    }
  }
}

type UserInteractionRespondedEvent = {
  type: 'UserInteractionResponded'
  payload: {
    interactionId: string
    taskId: string
    authorActorId: string

    selectedOptionId?: string
    inputValue?: string
    comment?: string
  }
}
```

### 1.4 Full DomainEvent Union (V0.1)

```typescript
type DomainEvent =
  // Task Lifecycle
  | TaskCreatedEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCanceledEvent
  // UIP
  | UserInteractionRequestedEvent
  | UserInteractionRespondedEvent

type EventType = DomainEvent['type']
```

### 1.5 V0.1 Event Set (7 types)

| Event | Description |
|------|------|
| `TaskCreated` | User initiates a task request (including designated agentId) |
| `TaskStarted` | Task execution begins |
| `UserInteractionRequested` | System initiates an interaction request (unified protocol) |
| `UserInteractionResponded` | User responds to an interaction request |
| `TaskCompleted` | Task successfully completed |
| `TaskFailed` | Task execution failed |
| `TaskCanceled` | Task was canceled |

---

## 2. Entity Definitions

### 2.1 Actor

```typescript
import { z } from 'zod'

export const ActorKindSchema = z.enum(['human', 'agent'])

export const ActorCapabilitySchema = z.enum([
  'tool_read_file',
  'tool_edit_file',
  'tool_run_command',
  'run_latex_build',
  'read_assets',
  'create_task'
  // V1: 'claim_task' - Agent proactively claims task
])

export const ActorSchema = z.object({
  id: z.string().min(1),
  kind: ActorKindSchema,
  displayName: z.string().min(1),
  capabilities: z.array(ActorCapabilitySchema),
  defaultAgentId: z.string().optional()
})

export type ActorKind = z.infer<typeof ActorKindSchema>
export type ActorCapability = z.infer<typeof ActorCapabilitySchema>
export type Actor = z.infer<typeof ActorSchema>
```

### 2.2 Task

```typescript
export const TaskStatusSchema = z.enum([
  'open',
  'in_progress',
  'awaiting_user',
  'done',
  'failed',
  'canceled'
])

export const TaskPrioritySchema = z.enum([
  'foreground',
  'normal',
  'background'
])

export const ArtifactRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file_range'),
    path: z.string().min(1),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive()
  }),
  z.object({
    kind: z.literal('outline_anchor'),
    sectionId: z.string().min(1)
  }),
  z.object({
    kind: z.literal('asset'),
    assetId: z.string().min(1)
  }),
  z.object({
    kind: z.literal('citation'),
    citeKey: z.string().min(1)
  })
])

export const TaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  intent: z.string(),
  createdBy: z.string().min(1),           // ActorId
  priority: TaskPrioritySchema,
  status: TaskStatusSchema,
  artifactRefs: z.array(ArtifactRefSchema).optional(),
  createdAt: z.string().min(1),
  // V1: Subtask support
  parentTaskId: z.string().optional()
})

export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type TaskPriority = z.infer<typeof TaskPrioritySchema>
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>
export type Task = z.infer<typeof TaskSchema>
```

### 2.3 Artifact

```typescript
export const ArtifactTypeSchema = z.enum([
  'tex',
  'outline_md',
  'brief_md',
  'style_md',
  'bib',
  'figure',
  'data',
  'code',
  'other'
])

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  type: ArtifactTypeSchema,
  path: z.string().min(1),
  metadata: z.record(z.unknown()).optional()
})

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>
export type Artifact = z.infer<typeof ArtifactSchema>
```

### 2.4 Note: Plan/Patch (Deprecated)

V0.1 no longer includes plan/patch as part of domain objects and events. If you need compatibility with historical event logs or reference for old implementations, please refer to `Appendix A (Deprecated)` at the end of this document.

---

## 3. Projection Definitions

Projections are read models derived from the event stream for fast queries.

### 3.1 TaskView

```typescript
/**
 * TaskView - Read model for fast task queries.
 * Projected from DomainEvents via reducer.
 */
export type TaskView = {
  taskId: string
  title: string
  intent: string
  createdBy: string
  agentId: string                 // V0: Processing Agent specified directly upon creation
  priority: TaskPriority
  status: TaskStatus
  artifactRefs?: ArtifactRef[]
  
  // UIP Interaction State
  pendingInteractionId?: string   // ID of the interaction currently awaiting response
  lastInteractionId?: string      // ID of the last interaction
  
  // V1 Reserved: Subtask support
  parentTaskId?: string
  childTaskIds?: string[]
  
  createdAt: string
  updatedAt: string               // Timestamp of the last event
}
```

### 3.2 Projection Reducer Specification

```typescript
export type ProjectionReducer<TState> = (
  state: TState,
  event: StoredEvent
) => TState
```

Each Projection must:
1. Provide a `defaultState`.
2. Provide a pure function `reducer`.
3. Support idempotency (applying the same event multiple times yields the same result).

---

## 4. Policy Rules

Policies are pure functions used for decision logic. They do not depend on external state.

### 4.1 V0 Task Distribution Model

V0 adopts a **Single Agent direct model**, requiring no routing:

```
User → Billboard (TaskCreated) → Default Agent automatically claims → Workflow execution
```

This is similar to a chat mode, but tasks are formed through the Billboard, creating an auditable Task history.

**V1 Extension: Orchestrator Subtask Model (Interaction layer only)**

When an Orchestrator needs to split work into multiple subtasks and select performers, V0.1 only requires the interaction to use UIP:
- `UserInteractionRequested(purpose=assign_subtask, kind=Select, options=[agentA, agentB, ...])`
- `UserInteractionResponded(selectedOptionId=agentB)`

Whether subtasks require additional domain events is a matter for future design (optional); this specification does not preset `SubtaskCreated/SubtaskCompleted` event types in DomainEvent.

### 4.2 SchedulerPolicy

```typescript
export type SchedulerPolicy = (
  tasks: TaskView[]
) => TaskView[]  // Returns sorted list of tasks

// V0 Default Implementation: Sort by priority and creation time
export const defaultSchedulerPolicy: SchedulerPolicy = (tasks) => {
  const priorityOrder = { foreground: 0, normal: 1, background: 2 }
  
  return [...tasks]
    .filter(t => t.status === 'open' || t.status === 'in_progress')
    .sort((a, b) => {
      // First by priority
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (pDiff !== 0) return pDiff
      // Then by creation time
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
}
```

---

## 5. Port Interface Definitions

### 5.1 EventStore

```typescript
export interface EventStore {
  // Initialize schema (create tables, etc.)
  ensureSchema(): void
  
  // Append events
  append(streamId: string, events: DomainEvent[]): StoredEvent[]
  
  // Read all events (after specified ID)
  readAll(fromIdExclusive?: number): StoredEvent[]
  
  // Read events for a specific stream
  readStream(streamId: string, fromSeqInclusive?: number): StoredEvent[]
  
  // Read a single event by ID
  readById(id: number): StoredEvent | null
  
  // Projection state management
  getProjection<TState>(name: string, defaultState: TState): {
    cursorEventId: number
    state: TState
  }
  saveProjection<TState>(name: string, cursorEventId: number, state: TState): void
}
```

### 5.2 ConversationStore

Used to persist the conversation history between Agent and LLM, supporting state recovery across UIP pauses and program restarts.

```typescript
import type { LLMMessage } from './llmClient.js'

/**
 * Conversation Entry - Message + Task Context
 */
export type ConversationEntry = {
  taskId: string       // Associated task
  index: number        // Sequential index within the task
  message: LLMMessage  // LLM message
}

/**
 * Persisted Conversation Entry (with metadata)
 */
export type StoredConversationEntry = ConversationEntry & {
  id: number           // Global auto-increment ID
  createdAt: string    // ISO timestamp
}

/**
 * ConversationStore Port Interface
 *
 * Separation of Responsibilities:
 * - EventStore: User ↔ Agent collaboration decisions
 * - AuditLog: Agent ↔ Tools/Files execution auditing
 * - ConversationStore: Agent ↔ LLM conversation context
 */
export interface ConversationStore {
  // Initialize schema
  ensureSchema(): void
  
  // Append message to task conversation history
  append(taskId: string, message: LLMMessage): StoredConversationEntry
  
  // Get all messages for a task (in order)
  getMessages(taskId: string): LLMMessage[]
  
  // Truncate conversation history, keeping only the last N entries
  truncate(taskId: string, keepLastN: number): void
  
  // Clear all conversation history for a task
  clear(taskId: string): void
  
  // Read all entries (for debugging/testing)
  readAll(fromIdExclusive?: number): StoredConversationEntry[]
}
```

### 5.3 ArtifactStore

```typescript
export interface ArtifactStore {
  // Read file content
  readFile(path: string): Promise<string>
  
  // Read specific line range from file
  readFileRange(path: string, lineStart: number, lineEnd: number): Promise<string>
  
  // Get file version (hash)
  getRevision(path: string): Promise<string>
  
  // List directory contents
  listDir(path: string): Promise<string[]>
  
  // Write to file
  writeFile(path: string, content: string): Promise<void>
}
```

### 5.4 LLMClient

```typescript
import type { ToolDefinition, ToolCallRequest } from './tool.js'

export type LLMProfile = 'fast' | 'writer' | 'reasoning'

export type LLMMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: ToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; content: string }

// ============================================================================
// LLM Response Types
// ============================================================================

export type LLMStopReason = 'end_turn' | 'tool_use' | 'max_tokens'

export type LLMResponse = {
  content?: string
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
```

---

## 6. Naming Conventions

### 6.1 ID Naming

| Type | Format | Example |
|------|------|------|
| taskId | nanoid(21) | `V1StGXR8_Z5jdHi6B-myT` |
| interactionId | `ui_` + nanoid(12) | `ui_abc123def456` |
| toolCallId | `tool_` + nanoid(12) | `tool_xyz789uvw012` |
| actorId (user) | `user_` + identifier | `user_jerry` |
| actorId (agent) | `agent_` + name | `agent_coauthor_default` |

### 6.2 Event Stream ID

| Stream Type | streamId Format |
|--------|---------------|
| Task Stream | `task_{taskId}` or directly `taskId` |
| Global Stream | No splitting, all events sorted by `id` |

### 6.3 File Paths

- Use paths relative to `baseDir`.
- Use POSIX style (`/` separator).
- Example: `chapters/01_introduction.tex`

---

## 7. Validation Rules

### 7.1 Event Validation

All events must be validated via Zod schema before writing:

```typescript
export function validateEvent(event: unknown): DomainEvent {
  return DomainEventSchema.parse(event)
}
```

### 7.2 Business Rule Validation

| Rule | Description |
|------|------|
| Task State Transition | Transitions must strictly follow the state machine (see diagram below). |
| High-Risk Tool Actions | Actions like writing files or executing commands must first pass UIP `confirm_risky_action`. |
| Actor Permissions | Tools can only be used if the Actor possesses the corresponding tool capability. |

### 7.3 Task State Machine (V0)

```
(TaskCreated) open ────────────────────────────────────→ canceled
  │
  ├─ TaskStarted ──→ in_progress
  │                      │
  │                      ├─ UserInteractionRequested ──→ awaiting_user
  │                      │                                 │
  │                      │                                 └─ UserInteractionResponded ──→ in_progress
  │                      │
  │                      ├─ TaskCompleted ──→ done
  │                      │
  │                      └─ TaskFailed ──→ failed
  │
  └─ TaskFailed ──→ failed
```

> MVP: No `TaskClaimed` event or `claimed` state introduced; `TaskStarted` is the sole marker for "beginning execution."

---

## 8. Compatibility Mapping with Existing Code

| Existing Code | New Specification |
|----------|--------|
| `domain.ts` | Split into `domain/events.ts` + `domain/task.ts` + `domain/actor.ts` |
| `TaskCreated.payload.taskId` | Retained, with added `authorActorId` |
| Old events like `Patch*`/`AgentPlanPosted` | No longer DomainEvents (V0.1); migrated to UIP + Tool Audit expressions (see Appendix A). |

---

## Appendix A (Deprecated): Old Plan/Patch Events and Migration Mapping

This appendix is intended only for reading historical event logs or migrating old implementations. Starting with V0.1, these events should no longer be added or used as part of the collaboration protocol.

### A.1 Old Event List (Historical Compatibility)

- `AgentPlanPosted`
- `PatchProposed` / `PatchAccepted` / `PatchRejected` / `PatchApplied` / `PatchConflicted`
- `UserFeedbackPosted`

### A.2 Migration Mapping (Recommended Expression)

- Plan/Proposal Presentation: Use `UserInteractionRequested(display.contentKind=PlainText|Json, purpose=choose_strategy)`.
- Diff/Change Preview: Use `UserInteractionRequested(display.contentKind=Diff, purpose=confirm_risky_action)`.
- File Modification and Command Execution: Executed via Tool Use and recorded in AuditLog as `ToolCallRequested/ToolCallCompleted`; do not use DomainEvents to record specific diffs or write details.
- Conflict/Failure: Guided by tool execution results (e.g., `isError=true` in AuditLog) and subsequent UIP interactions to guide user decisions; terminate task with `TaskFailed` if necessary.
