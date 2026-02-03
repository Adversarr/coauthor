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

// ============================================================================
// Plan & Patch Events
// ============================================================================

export const PlanSchema = z.object({
  goal: z.string().min(1),
  issues: z.array(z.string()).optional(),
  strategy: z.string().min(1),
  scope: z.string().min(1),
  risks: z.array(z.string()).optional(),
  questions: z.array(z.string()).optional()
})

export const AgentPlanPostedPayloadSchema = z.object({
  taskId: z.string().min(1),
  planId: z.string().min(1),
  plan: PlanSchema,
  ...withAuthor
})

export const PatchProposedPayloadSchema = z.object({
  taskId: z.string().min(1),
  proposalId: z.string().min(1),
  targetPath: z.string().min(1),
  patchText: z.string().min(1),
  baseRevision: z.string().optional(),
  ...withAuthor
})

export const PatchAcceptedPayloadSchema = z.object({
  taskId: z.string().min(1),
  proposalId: z.string().min(1),
  ...withAuthor
})

export const PatchRejectedPayloadSchema = z.object({
  taskId: z.string().min(1),
  proposalId: z.string().min(1),
  reason: z.string().optional(),
  ...withAuthor
})

export const PatchAppliedPayloadSchema = z.object({
  taskId: z.string().min(1),
  proposalId: z.string().min(1),
  targetPath: z.string().min(1),
  patchText: z.string().min(1),
  appliedAt: z.string().min(1),
  newRevision: z.string().optional(),
  ...withAuthor
})

// ============================================================================
// Feedback & Interaction Events
// ============================================================================

export const UserFeedbackPostedPayloadSchema = z.object({
  taskId: z.string().min(1),
  feedback: z.string().min(1),
  targetProposalId: z.string().optional(),
  ...withAuthor
})

// ============================================================================
// Conflict Events
// ============================================================================

export const PatchConflictedPayloadSchema = z.object({
  taskId: z.string().min(1),
  proposalId: z.string().min(1),
  targetPath: z.string().min(1),
  reason: z.string().min(1),
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
  // Plan & Patch
  'AgentPlanPosted',
  'PatchProposed',
  'PatchAccepted',
  'PatchRejected',
  'PatchApplied',
  // Feedback
  'UserFeedbackPosted',
  // Conflict
  'PatchConflicted'
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
export type AgentPlanPostedPayload = z.infer<typeof AgentPlanPostedPayloadSchema>
export type PatchProposedPayload = z.infer<typeof PatchProposedPayloadSchema>
export type PatchAcceptedPayload = z.infer<typeof PatchAcceptedPayloadSchema>
export type PatchRejectedPayload = z.infer<typeof PatchRejectedPayloadSchema>
export type PatchAppliedPayload = z.infer<typeof PatchAppliedPayloadSchema>
export type UserFeedbackPostedPayload = z.infer<typeof UserFeedbackPostedPayloadSchema>
export type PatchConflictedPayload = z.infer<typeof PatchConflictedPayloadSchema>
export type Plan = z.infer<typeof PlanSchema>

// ============================================================================
// Domain Event Union - 12 event types (V0)
// ============================================================================

// Complete event union: all state transitions in the system
export type DomainEvent =
  // Task lifecycle
  | { type: 'TaskCreated'; payload: TaskCreatedPayload }
  | { type: 'TaskStarted'; payload: TaskStartedPayload }
  | { type: 'TaskCompleted'; payload: TaskCompletedPayload }
  | { type: 'TaskFailed'; payload: TaskFailedPayload }
  | { type: 'TaskCanceled'; payload: TaskCanceledPayload }
  // Plan & Patch
  | { type: 'AgentPlanPosted'; payload: AgentPlanPostedPayload }
  | { type: 'PatchProposed'; payload: PatchProposedPayload }
  | { type: 'PatchAccepted'; payload: PatchAcceptedPayload }
  | { type: 'PatchRejected'; payload: PatchRejectedPayload }
  | { type: 'PatchApplied'; payload: PatchAppliedPayload }
  // Feedback
  | { type: 'UserFeedbackPosted'; payload: UserFeedbackPostedPayload }
  // Conflict
  | { type: 'PatchConflicted'; payload: PatchConflictedPayload }

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
  // Plan & Patch
  z.object({ type: z.literal('AgentPlanPosted'), payload: AgentPlanPostedPayloadSchema }),
  z.object({ type: z.literal('PatchProposed'), payload: PatchProposedPayloadSchema }),
  z.object({ type: z.literal('PatchAccepted'), payload: PatchAcceptedPayloadSchema }),
  z.object({ type: z.literal('PatchRejected'), payload: PatchRejectedPayloadSchema }),
  z.object({ type: z.literal('PatchApplied'), payload: PatchAppliedPayloadSchema }),
  // Feedback
  z.object({ type: z.literal('UserFeedbackPosted'), payload: UserFeedbackPostedPayloadSchema }),
  // Conflict
  z.object({ type: z.literal('PatchConflicted'), payload: PatchConflictedPayloadSchema })
])

// ============================================================================
// Parser Function
// ============================================================================

// Parse and validate raw event data
export function parseDomainEvent(input: unknown): DomainEvent {
  return DomainEventSchema.parse(input)
}

