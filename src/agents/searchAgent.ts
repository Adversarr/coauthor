import type { ContextBuilder } from '../application/contextBuilder.js'
import type { LLMProfile } from '../domain/ports/llmClient.js'
import type { ToolGroup } from '../domain/ports/tool.js'
import { BaseToolAgent } from './baseAgent.js'
import { SEARCH_SYSTEM_PROMPT } from './templates.js'

// ============================================================================
// Search Agent — Read-Only Research
// ============================================================================

/**
 * Search Agent.
 *
 * Searches and surveys the codebase using read-only tools only.
 * Cannot modify files, run commands, or create subtasks.
 */
export class SearchAgent extends BaseToolAgent {
  readonly id = 'agent_search'
  readonly displayName = 'Search Agent'
  readonly description =
    'Research agent that searches and surveys codebase using read-only tools (readFile, listFiles, glob, grep).'
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
    return 'Search the workspace to answer this question. Use the available tools to find relevant files and content. Summarize your findings clearly.'
  }
}
