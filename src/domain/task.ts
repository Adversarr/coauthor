import { z } from 'zod'

// ============================================================================
// Task Types
// ============================================================================

// Task state machine: open → in_progress → awaiting_user → done/failed/canceled
export const TaskStatusSchema = z.enum([
  'open',
  'in_progress',
  'awaiting_user',
  'paused',
  'done',
  'failed',
  'canceled'
])

export const TaskPrioritySchema = z.enum([
  'foreground',
  'normal',
  'background'
])

// ============================================================================
// Artifact Reference Types
// ============================================================================

// Discriminated union: points to specific parts of documents/assets
export const FileRangeRefSchema = z.object({
  kind: z.literal('file_range'),
  path: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive()
})

export const OutlineAnchorRefSchema = z.object({
  kind: z.literal('outline_anchor'),
  sectionId: z.string().min(1)
})

export const AssetRefSchema = z.object({
  kind: z.literal('asset'),
  assetId: z.string().min(1)
})

export const CitationRefSchema = z.object({
  kind: z.literal('citation'),
  citeKey: z.string().min(1)
})

export const ArtifactRefSchema = z.discriminatedUnion('kind', [
  FileRangeRefSchema,
  OutlineAnchorRefSchema,
  AssetRefSchema,
  CitationRefSchema
])

// ============================================================================
// Task Schema
// ============================================================================

export const TaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  intent: z.string(),
  createdBy: z.string().min(1),
  agentId: z.string().min(1),           // V0: Specify processing Agent directly upon creation
  priority: TaskPrioritySchema,
  status: TaskStatusSchema,
  artifactRefs: z.array(ArtifactRefSchema).optional(),
  createdAt: z.string().min(1),
  parentTaskId: z.string().optional()   // V1: Subtask support
})

// ============================================================================
// Type Exports
// ============================================================================

export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type TaskPriority = z.infer<typeof TaskPrioritySchema>
export type FileRangeRef = z.infer<typeof FileRangeRefSchema>
export type OutlineAnchorRef = z.infer<typeof OutlineAnchorRefSchema>
export type AssetRef = z.infer<typeof AssetRefSchema>
export type CitationRef = z.infer<typeof CitationRefSchema>
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>
export type Task = z.infer<typeof TaskSchema>
