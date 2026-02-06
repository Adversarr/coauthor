import { z } from 'zod'
import { ArtifactRefSchema, TaskPrioritySchema } from './task.js'

// ============================================================================
// Shared Payload Components
// ============================================================================

// Audit: All events require actor attribution
const withAuthor = {
  authorActorId: z.string().min(1)
}

// ============================================================================
// Task Lifecycle Events
// ============================================================================

export const TaskCreatedPayloadSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  intent: z.string().default(''),
  priority: TaskPrioritySchema.default('foreground'),
  artifactRefs: z.array(ArtifactRefSchema).optional(),
  agentId: z.string().min(1),
  ...withAuthor
})

export const TaskStartedPayloadSchema = z.object({
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  ...withAuthor
})

export const TaskCompletedPayloadSchema = z.object({
  taskId: z.string().min(1),
  summary: z.string().optional(),
  ...withAuthor
})

export const TaskFailedPayloadSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1),
  ...withAuthor
})

export const TaskCanceledPayloadSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().optional(),
  ...withAuthor
})

export const TaskPausedPayloadSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().optional(),
  ...withAuthor
})

export const TaskResumedPayloadSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().optional(),
  ...withAuthor
})

export const TaskInstructionAddedPayloadSchema = z.object({
  taskId: z.string().min(1),
  instruction: z.string().min(1),
  ...withAuthor
})

// ============================================================================
// UIP (Universal Interaction Protocol) Events
// ============================================================================

export const InteractionKindSchema = z.enum(['Select', 'Confirm', 'Input', 'Composite'])

export const InteractionPurposeSchema = z.enum([
  'choose_strategy',
  'request_info',
  'confirm_risky_action',
  'assign_subtask',  // V1: Orchestrator subtask assignment
  'generic'
])

export const ContentKindSchema = z.enum(['PlainText', 'Json', 'Diff', 'Table'])

export const InteractionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  style: z.enum(['primary', 'danger', 'default']).optional(),
  isDefault: z.boolean().optional()
})

export const InteractionDisplaySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  content: z.unknown().optional(),
  contentKind: ContentKindSchema.optional()
})

export const InteractionValidationSchema = z.object({
  regex: z.string().optional(),
  required: z.boolean().optional()
})

export const UserInteractionRequestedPayloadSchema = z.object({
  interactionId: z.string().min(1),
  taskId: z.string().min(1),
  kind: InteractionKindSchema,
  purpose: InteractionPurposeSchema,
  display: InteractionDisplaySchema,
  options: z.array(InteractionOptionSchema).optional(),
  validation: InteractionValidationSchema.optional(),
  ...withAuthor
})

export const UserInteractionRespondedPayloadSchema = z.object({
  interactionId: z.string().min(1),
  taskId: z.string().min(1),
  selectedOptionId: z.string().optional(),
  inputValue: z.string().optional(),
  comment: z.string().optional(),
  ...withAuthor
})

// ============================================================================
// Event Type Enum
// ============================================================================

export const EventTypeSchema = z.enum([
  // Task lifecycle
  'TaskCreated',
  'TaskStarted',
  'TaskCompleted',
  'TaskFailed',
  'TaskCanceled',
  'TaskPaused',
  'TaskResumed',
  'TaskInstructionAdded',
  // UIP
  'UserInteractionRequested',
  'UserInteractionResponded'
])

export type EventType = z.infer<typeof EventTypeSchema>

// ============================================================================
// Payload Type Exports
// ============================================================================

export type TaskCreatedPayload = z.infer<typeof TaskCreatedPayloadSchema>
export type TaskStartedPayload = z.infer<typeof TaskStartedPayloadSchema>
export type TaskCompletedPayload = z.infer<typeof TaskCompletedPayloadSchema>
export type TaskFailedPayload = z.infer<typeof TaskFailedPayloadSchema>
export type TaskCanceledPayload = z.infer<typeof TaskCanceledPayloadSchema>
export type TaskPausedPayload = z.infer<typeof TaskPausedPayloadSchema>
export type TaskResumedPayload = z.infer<typeof TaskResumedPayloadSchema>
export type TaskInstructionAddedPayload = z.infer<typeof TaskInstructionAddedPayloadSchema>
export type UserInteractionRequestedPayload = z.infer<typeof UserInteractionRequestedPayloadSchema>
export type UserInteractionRespondedPayload = z.infer<typeof UserInteractionRespondedPayloadSchema>

// UIP sub-types
export type InteractionKind = z.infer<typeof InteractionKindSchema>
export type InteractionPurpose = z.infer<typeof InteractionPurposeSchema>
export type ContentKind = z.infer<typeof ContentKindSchema>
export type InteractionOption = z.infer<typeof InteractionOptionSchema>
export type InteractionDisplay = z.infer<typeof InteractionDisplaySchema>
export type InteractionValidation = z.infer<typeof InteractionValidationSchema>

// ============================================================================
// Domain Event Union - 7 event types (V1 - UIP Architecture)
// ============================================================================

// Complete event union: all state transitions in the system
// Note: File modifications and tool calls are logged in AuditLog, not DomainEvents
export type DomainEvent =
  // Task lifecycle
  | { type: 'TaskCreated'; payload: TaskCreatedPayload }
  | { type: 'TaskStarted'; payload: TaskStartedPayload }
  | { type: 'TaskCompleted'; payload: TaskCompletedPayload }
  | { type: 'TaskFailed'; payload: TaskFailedPayload }
  | { type: 'TaskCanceled'; payload: TaskCanceledPayload }
  | { type: 'TaskPaused'; payload: TaskPausedPayload }
  | { type: 'TaskResumed'; payload: TaskResumedPayload }
  | { type: 'TaskInstructionAdded'; payload: TaskInstructionAddedPayload }
  // UIP (Universal Interaction Protocol)
  | { type: 'UserInteractionRequested'; payload: UserInteractionRequestedPayload }
  | { type: 'UserInteractionResponded'; payload: UserInteractionRespondedPayload }

// ============================================================================
// Stored Event (with persistence metadata)
// ============================================================================

export type StoredEvent = DomainEvent & {
  id: number
  streamId: string
  seq: number
  createdAt: string
}

// ============================================================================
// Domain Event Schema (for validation)
// ============================================================================

// Runtime validation schema for events - ensures type safety on deserialization
export const DomainEventSchema = z.discriminatedUnion('type', [
  // Task lifecycle
  z.object({ type: z.literal('TaskCreated'), payload: TaskCreatedPayloadSchema }),
  z.object({ type: z.literal('TaskStarted'), payload: TaskStartedPayloadSchema }),
  z.object({ type: z.literal('TaskCompleted'), payload: TaskCompletedPayloadSchema }),
  z.object({ type: z.literal('TaskFailed'), payload: TaskFailedPayloadSchema }),
  z.object({ type: z.literal('TaskCanceled'), payload: TaskCanceledPayloadSchema }),
  z.object({ type: z.literal('TaskPaused'), payload: TaskPausedPayloadSchema }),
  z.object({ type: z.literal('TaskResumed'), payload: TaskResumedPayloadSchema }),
  z.object({ type: z.literal('TaskInstructionAdded'), payload: TaskInstructionAddedPayloadSchema }),
  // UIP
  z.object({ type: z.literal('UserInteractionRequested'), payload: UserInteractionRequestedPayloadSchema }),
  z.object({ type: z.literal('UserInteractionResponded'), payload: UserInteractionRespondedPayloadSchema })
])

// ============================================================================
// Parser Function
// ============================================================================

// Parse and validate raw event data
export function parseDomainEvent(input: unknown): DomainEvent {
  return DomainEventSchema.parse(input)
}
