import { z } from 'zod'

// ============================================================================
// Actor Types
// ============================================================================

// Actor: source of all state changes (who did the action)
export const ActorKindSchema = z.enum(['human', 'agent'])

export const ActorCapabilitySchema = z.enum([
  'apply_patch',
  'run_latex_build',
  'read_assets',
  'create_task'
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

// ============================================================================
// Well-known Actor IDs
// ============================================================================

/** System actor for automated events */
export const SYSTEM_ACTOR_ID = 'system'

/** Default user actor ID */
export const DEFAULT_USER_ACTOR_ID = 'user_default'

/** Default agent actor ID */
export const DEFAULT_AGENT_ACTOR_ID = 'agent_coauthor_default'

// ============================================================================
// Factory Functions
// ============================================================================

export function createUserActor(opts: {
  id?: string
  displayName: string
  defaultAgentId?: string
}): Actor {
  return {
    id: opts.id ?? DEFAULT_USER_ACTOR_ID,
    kind: 'human',
    displayName: opts.displayName,
    capabilities: ['apply_patch', 'create_task', 'read_assets'],
    defaultAgentId: opts.defaultAgentId ?? DEFAULT_AGENT_ACTOR_ID
  }
}

export function createAgentActor(opts: {
  id: string
  displayName: string
  capabilities?: ActorCapability[]
}): Actor {
  return {
    id: opts.id,
    kind: 'agent',
    displayName: opts.displayName,
    capabilities: opts.capabilities ?? ['read_assets']
  }
}
