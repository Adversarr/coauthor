import type { ContextBuilder } from '../../application/context/contextBuilder.js'
import type { LLMProfile } from '../../core/ports/llmClient.js'
import type { ToolGroup } from '../../core/ports/tool.js'
import { BaseToolAgent } from '../core/baseAgent.js'
import { DEFAULT_SEED_SYSTEM_PROMPT } from './templates.js'

// ============================================================================
// Coordinator Agent - Tool Use Workflow
// ============================================================================

/**
 * Coordinator Agent.
 *
 * Full-capability agent with access to all tool groups.
 * Implements the tool loop: call LLM → yield tool calls → repeat.
 *
 * The agent is risk-unaware. It yields tool call outputs without any risk
 * gating. The Runtime/OutputHandler intercepts risky tools and handles UIP
 * confirmation before execution — agents never need to know about risk.
 */
export class DefaultSeedAgent extends BaseToolAgent {
  readonly id = 'agent_seed_coordinator'
  readonly displayName = 'Coordinator Agent'
  readonly description =
    'General execution agent that plans work, uses tools, and delegates subtasks when useful.'
  readonly toolGroups: readonly ToolGroup[] = ['search', 'edit', 'exec', 'subtask']
  readonly defaultProfile: LLMProfile

  constructor(opts: {
    contextBuilder: ContextBuilder
    maxIterations?: number
    maxTokens?: number
    defaultProfile?: LLMProfile
    systemPromptTemplate?: string
  }) {
    super({
      contextBuilder: opts.contextBuilder,
      maxIterations: opts.maxIterations,
      maxTokens: opts.maxTokens,
      systemPromptTemplate: opts.systemPromptTemplate ?? DEFAULT_SEED_SYSTEM_PROMPT
    })
    this.defaultProfile = opts.defaultProfile ?? 'fast'
  }
}
