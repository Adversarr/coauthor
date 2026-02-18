import { z } from 'zod'

// ============================================================================
// Task Types
// ============================================================================

export const TaskPrioritySchema = z.enum([
  'foreground',
  'normal',
  'background'
])

const TaskTodoStatusSchema = z.enum([
  'pending',
  'completed'
])

const TaskTodoItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  status: TaskTodoStatusSchema
})

// ============================================================================
// Artifact Reference Types
// ============================================================================

// Discriminated union: points to specific parts of documents/assets
const FileRangeRefSchema = z.object({
  kind: z.literal('file_range'),
  path: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive()
})

const OutlineAnchorRefSchema = z.object({
  kind: z.literal('outline_anchor'),
  sectionId: z.string().min(1)
})

const AssetRefSchema = z.object({
  kind: z.literal('asset'),
  assetId: z.string().min(1)
})

const CitationRefSchema = z.object({
  kind: z.literal('citation'),
  citeKey: z.string().min(1)
})

const ArtifactRefSchema = z.discriminatedUnion('kind', [
  FileRangeRefSchema,
  OutlineAnchorRefSchema,
  AssetRefSchema,
  CitationRefSchema
])

// ============================================================================
// Type Exports
// ============================================================================

export type TaskPriority = z.infer<typeof TaskPrioritySchema>
export type TaskTodoStatus = z.infer<typeof TaskTodoStatusSchema>
export type TaskTodoItem = z.infer<typeof TaskTodoItemSchema>
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>
