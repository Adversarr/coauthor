import { z } from 'zod'
import { ArtifactRefSchema, TaskPrioritySchema } from './task.js'

// ============================================================================
// Shared Payload Components
// ============================================================================

/** All events must have authorActorId */
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
  ...withAuthor
})

export const TaskRoutedPayloadSchema = z.object({
  taskId: z.string().min(1),
  assignedTo: z.string().min(1),
  routedBy: z.string().min(1),
  ...withAuthor
})

export const TaskClaimedPayloadSchema = z.object({
  taskId: z.string().min(1),
  claimedBy: z.string().min(1),
  baseRevisions: z.record(z.string()).optional(),
  ...withAuthor
})

export const TaskStartedPayloadSchema = z.object({
  taskId: z.string().min(1),
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

export const TaskBlockedPayloadSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1),
  questions: z.array(z.string()).optional(),
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

export const ThreadOpenedPayloadSchema = z.object({
  taskId: z.string().min(1),
  ...withAuthor
})

// ============================================================================
// Artifact & File Events
// ============================================================================

export const ArtifactChangedPayloadSchema = z.object({
  path: z.string().min(1),
  oldRevision: z.string().optional(),
  newRevision: z.string().min(1),
  changeKind: z.enum(['created', 'modified', 'deleted']),
  ...withAuthor
})

export const TaskNeedsRebasePayloadSchema = z.object({
  taskId: z.string().min(1),
  affectedPaths: z.array(z.string().min(1)),
  reason: z.string().min(1),
  ...withAuthor
})

export const TaskRebasedPayloadSchema = z.object({
  taskId: z.string().min(1),
  oldBaseRevisions: z.record(z.string()),
  newBaseRevisions: z.record(z.string()),
  ...withAuthor
})

// ============================================================================
// Event Type Enum
// ============================================================================

export const EventTypeSchema = z.enum([
  // Task lifecycle
  'TaskCreated',
  'TaskRouted',
  'TaskClaimed',
  'TaskStarted',
  'TaskCompleted',
  'TaskFailed',
  'TaskCanceled',
  'TaskBlocked',
  // Plan & Patch
  'AgentPlanPosted',
  'PatchProposed',
  'PatchAccepted',
  'PatchRejected',
  'PatchApplied',
  // Feedback & Interaction
  'UserFeedbackPosted',
  'ThreadOpened',
  // Artifact & File
  'ArtifactChanged',
  'TaskNeedsRebase',
  'TaskRebased'
])

export type EventType = z.infer<typeof EventTypeSchema>

// ============================================================================
// Payload Type Exports
// ============================================================================

export type TaskCreatedPayload = z.infer<typeof TaskCreatedPayloadSchema>
export type TaskRoutedPayload = z.infer<typeof TaskRoutedPayloadSchema>
export type TaskClaimedPayload = z.infer<typeof TaskClaimedPayloadSchema>
export type TaskStartedPayload = z.infer<typeof TaskStartedPayloadSchema>
export type TaskCompletedPayload = z.infer<typeof TaskCompletedPayloadSchema>
export type TaskFailedPayload = z.infer<typeof TaskFailedPayloadSchema>
export type TaskCanceledPayload = z.infer<typeof TaskCanceledPayloadSchema>
export type TaskBlockedPayload = z.infer<typeof TaskBlockedPayloadSchema>
export type AgentPlanPostedPayload = z.infer<typeof AgentPlanPostedPayloadSchema>
export type PatchProposedPayload = z.infer<typeof PatchProposedPayloadSchema>
export type PatchAcceptedPayload = z.infer<typeof PatchAcceptedPayloadSchema>
export type PatchRejectedPayload = z.infer<typeof PatchRejectedPayloadSchema>
export type PatchAppliedPayload = z.infer<typeof PatchAppliedPayloadSchema>
export type UserFeedbackPostedPayload = z.infer<typeof UserFeedbackPostedPayloadSchema>
export type ThreadOpenedPayload = z.infer<typeof ThreadOpenedPayloadSchema>
export type ArtifactChangedPayload = z.infer<typeof ArtifactChangedPayloadSchema>
export type TaskNeedsRebasePayload = z.infer<typeof TaskNeedsRebasePayloadSchema>
export type TaskRebasedPayload = z.infer<typeof TaskRebasedPayloadSchema>
export type Plan = z.infer<typeof PlanSchema>

// ============================================================================
// Domain Event Union
// ============================================================================

export type DomainEvent =
  // Task lifecycle
  | { type: 'TaskCreated'; payload: TaskCreatedPayload }
  | { type: 'TaskRouted'; payload: TaskRoutedPayload }
  | { type: 'TaskClaimed'; payload: TaskClaimedPayload }
  | { type: 'TaskStarted'; payload: TaskStartedPayload }
  | { type: 'TaskCompleted'; payload: TaskCompletedPayload }
  | { type: 'TaskFailed'; payload: TaskFailedPayload }
  | { type: 'TaskCanceled'; payload: TaskCanceledPayload }
  | { type: 'TaskBlocked'; payload: TaskBlockedPayload }
  // Plan & Patch
  | { type: 'AgentPlanPosted'; payload: AgentPlanPostedPayload }
  | { type: 'PatchProposed'; payload: PatchProposedPayload }
  | { type: 'PatchAccepted'; payload: PatchAcceptedPayload }
  | { type: 'PatchRejected'; payload: PatchRejectedPayload }
  | { type: 'PatchApplied'; payload: PatchAppliedPayload }
  // Feedback & Interaction
  | { type: 'UserFeedbackPosted'; payload: UserFeedbackPostedPayload }
  | { type: 'ThreadOpened'; payload: ThreadOpenedPayload }
  // Artifact & File
  | { type: 'ArtifactChanged'; payload: ArtifactChangedPayload }
  | { type: 'TaskNeedsRebase'; payload: TaskNeedsRebasePayload }
  | { type: 'TaskRebased'; payload: TaskRebasedPayload }

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

export const DomainEventSchema = z.discriminatedUnion('type', [
  // Task lifecycle
  z.object({ type: z.literal('TaskCreated'), payload: TaskCreatedPayloadSchema }),
  z.object({ type: z.literal('TaskRouted'), payload: TaskRoutedPayloadSchema }),
  z.object({ type: z.literal('TaskClaimed'), payload: TaskClaimedPayloadSchema }),
  z.object({ type: z.literal('TaskStarted'), payload: TaskStartedPayloadSchema }),
  z.object({ type: z.literal('TaskCompleted'), payload: TaskCompletedPayloadSchema }),
  z.object({ type: z.literal('TaskFailed'), payload: TaskFailedPayloadSchema }),
  z.object({ type: z.literal('TaskCanceled'), payload: TaskCanceledPayloadSchema }),
  z.object({ type: z.literal('TaskBlocked'), payload: TaskBlockedPayloadSchema }),
  // Plan & Patch
  z.object({ type: z.literal('AgentPlanPosted'), payload: AgentPlanPostedPayloadSchema }),
  z.object({ type: z.literal('PatchProposed'), payload: PatchProposedPayloadSchema }),
  z.object({ type: z.literal('PatchAccepted'), payload: PatchAcceptedPayloadSchema }),
  z.object({ type: z.literal('PatchRejected'), payload: PatchRejectedPayloadSchema }),
  z.object({ type: z.literal('PatchApplied'), payload: PatchAppliedPayloadSchema }),
  // Feedback & Interaction
  z.object({ type: z.literal('UserFeedbackPosted'), payload: UserFeedbackPostedPayloadSchema }),
  z.object({ type: z.literal('ThreadOpened'), payload: ThreadOpenedPayloadSchema }),
  // Artifact & File
  z.object({ type: z.literal('ArtifactChanged'), payload: ArtifactChangedPayloadSchema }),
  z.object({ type: z.literal('TaskNeedsRebase'), payload: TaskNeedsRebasePayloadSchema }),
  z.object({ type: z.literal('TaskRebased'), payload: TaskRebasedPayloadSchema })
])

// ============================================================================
// Parser Function
// ============================================================================

export function parseDomainEvent(input: unknown): DomainEvent {
  return DomainEventSchema.parse(input)
}

// ============================================================================
// V0 Compatibility: Re-export legacy types for backward compatibility
// ============================================================================

/** @deprecated Use TaskCreatedPayload instead */
export type LegacyTaskCreatedPayload = { taskId: string; title: string }

/** @deprecated Use PatchProposedPayload instead */
export type LegacyPatchProposedPayload = {
  taskId: string
  proposalId: string
  targetPath: string
  patchText: string
}

/** @deprecated Use PatchAppliedPayload instead */
export type LegacyPatchAppliedPayload = {
  taskId: string
  proposalId: string
  targetPath: string
  patchText: string
  appliedAt: string
}
