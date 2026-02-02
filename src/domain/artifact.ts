import { z } from 'zod'

// ============================================================================
// Artifact Types
// ============================================================================

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
  revision: z.string().min(1),
  metadata: z.record(z.unknown()).optional()
})

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>
export type Artifact = z.infer<typeof ArtifactSchema>

// ============================================================================
// Figure Metadata (for schematic and result figures)
// ============================================================================

export const FigureMetadataSchema = z.object({
  source: z.string().min(1),       // Where does this figure come from?
  purpose: z.string().min(1),      // What is this figure for?
  message: z.string().optional(),  // What does this figure demonstrate? (required for result figures)
  figureKind: z.enum(['schematic', 'result']).optional()
})

export type FigureMetadata = z.infer<typeof FigureMetadataSchema>

// ============================================================================
// Code Metadata
// ============================================================================

export const CodeMetadataSchema = z.object({
  source: z.string().min(1),
  purpose: z.string().min(1),
  language: z.string().optional(),
  relatedSection: z.string().optional()  // Which section does this code relate to?
})

export type CodeMetadata = z.infer<typeof CodeMetadataSchema>
