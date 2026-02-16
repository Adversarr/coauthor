import type { ContextBuilder } from '../../application/context/contextBuilder.js'
import type { LLMProfile } from '../../core/ports/llmClient.js'
import type { ToolGroup } from '../../core/ports/tool.js'
import { BaseToolAgent } from '../core/baseAgent.js'
import { SEARCH_SYSTEM_PROMPT } from './templates.js'

// ============================================================================
// Research Agent — Read-Only Workspace Survey
// ============================================================================

/**
 * Research Agent.
 *
 * Searches and surveys the codebase using read-only tools only.
 * Cannot modify files, run commands, or create subtasks.
 */
export class SearchAgent extends BaseToolAgent {
  readonly id = 'agent_seed_research'
  readonly displayName = 'Research Agent'
  readonly description =
    'Read-only research agent that surveys workspace files and summarizes evidence-backed findings.'
  readonly toolGroups: readonly ToolGroup[] = ['search']
  readonly defaultProfile: LLMProfile

  constructor(opts: {
    contextBuilder: ContextBuilder
    maxIterations?: number
    maxTokens?: number
    defaultProfile?: LLMProfile
  }) {
    super({
      contextBuilder: opts.contextBuilder,
      maxIterations: opts.maxIterations ?? 20,
      maxTokens: opts.maxTokens,
      systemPromptTemplate: SEARCH_SYSTEM_PROMPT
    })
    this.defaultProfile = opts.defaultProfile ?? 'fast'
  }

  protected override getUserSuffix(): string {
    return 'Survey the workspace to answer this request. Use read-only tools to gather evidence and summarize findings with file references.'
  }
}
