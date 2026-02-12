/**
 * Zod schemas for domain event payloads — runtime validation for store handlers.
 *
 * Prevents crashes from malformed events by validating before destructuring (B8).
 * Each schema matches the backend DomainEvent payload shape.
 */

import { z } from 'zod'

// ── Task lifecycle ─────────────────────────────────────────────────────

export const TaskCreatedPayload = z.object({
  taskId: z.string(),
  title: z.string(),
  intent: z.string().optional(),
  authorActorId: z.string(),
  agentId: z.string(),
  priority: z.enum(['foreground', 'normal', 'background']).optional(),
  parentTaskId: z.string().optional(),
})

export const TaskIdPayload = z.object({
  taskId: z.string(),
})

export const TaskFailedPayload = z.object({
  taskId: z.string(),
  reason: z.string(),
})

export const TaskCompletedPayload = z.object({
  taskId: z.string(),
  summary: z.string().optional(),
})

export const TaskCanceledPayload = z.object({
  taskId: z.string(),
  reason: z.string().optional(),
})

// ── Interaction ────────────────────────────────────────────────────────

export const InteractionRequestedPayload = z.object({
  taskId: z.string(),
  interactionId: z.string(),
  kind: z.string().optional(),
  purpose: z.string().optional(),
})

export const InteractionRespondedPayload = z.object({
  taskId: z.string(),
  interactionId: z.string(),
  selectedOptionId: z.string().optional(),
  inputValue: z.string().optional(),
})

// ── Instruction ────────────────────────────────────────────────────────

export const InstructionAddedPayload = z.object({
  taskId: z.string(),
  instruction: z.string(),
})

// ── Stream / UI events ─────────────────────────────────────────────────

export const StreamPayload = z.object({
  taskId: z.string().min(1),
  kind: z.enum(['text', 'reasoning', 'verbose', 'error']),
  content: z.string(),
})

export const StreamEndPayload = z.object({
  taskId: z.string().min(1),
})

export const ToolCallStartPayload = z.object({
  taskId: z.string().min(1),
  agentId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
})

export const ToolCallEndPayload = z.object({
  taskId: z.string().min(1),
  agentId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  output: z.unknown(),
  isError: z.boolean(),
  durationMs: z.number(),
})

// ── Type helpers ───────────────────────────────────────────────────────

export type TaskCreatedPayload = z.infer<typeof TaskCreatedPayload>
export type TaskCompletedPayload = z.infer<typeof TaskCompletedPayload>
export type TaskFailedPayload = z.infer<typeof TaskFailedPayload>
export type TaskCanceledPayload = z.infer<typeof TaskCanceledPayload>
export type InteractionRequestedPayload = z.infer<typeof InteractionRequestedPayload>
export type InteractionRespondedPayload = z.infer<typeof InteractionRespondedPayload>
export type InstructionAddedPayload = z.infer<typeof InstructionAddedPayload>
export type StreamPayload = z.infer<typeof StreamPayload>
export type StreamEndPayload = z.infer<typeof StreamEndPayload>
export type ToolCallStartPayload = z.infer<typeof ToolCallStartPayload>
export type ToolCallEndPayload = z.infer<typeof ToolCallEndPayload>

/**
 * Safely parse an event payload. Returns undefined on validation failure (logs warning).
 */
export function safeParse<T>(schema: z.ZodType<T>, payload: unknown, eventType: string): T | undefined {
  const result = schema.safeParse(payload)
  if (!result.success) {
    console.warn(`[eventPayloads] Invalid ${eventType} payload:`, result.error.format())
    return undefined
  }
  return result.data
}
