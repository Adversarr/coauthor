import type { Agent, AgentContext, AgentOutput } from './agent.js'
import type { TaskView } from '../application/taskService.js'
import type { ContextBuilder } from '../application/contextBuilder.js'
import type { LLMProfile } from '../domain/ports/llmClient.js'
import type { ToolGroup } from '../domain/ports/tool.js'
import type { ContextData } from '../domain/context.js'
import { MINIMAL_SYSTEM_PROMPT } from './templates.js'

// ============================================================================
// Minimal Agent — Chat Only, No Tools
// ============================================================================

/**
 * Minimal chat agent with no tool access.
 * Single LLM call per task — no tool loop.
 */
export class MinimalAgent implements Agent {
  readonly id = 'agent_minimal'
  readonly displayName = 'Minimal Chat'
  readonly description = 'Simple chat agent with no tool access. Just answers questions directly.'
  readonly toolGroups: readonly ToolGroup[] = []
  readonly defaultProfile: LLMProfile

  readonly #contextBuilder: ContextBuilder
  readonly #maxTokens: number

  constructor(opts: {
    contextBuilder: ContextBuilder
    maxTokens?: number
    defaultProfile?: LLMProfile
  }) {
    this.#contextBuilder = opts.contextBuilder
    this.#maxTokens = opts.maxTokens ?? 4096
    this.defaultProfile = opts.defaultProfile ?? 'fast'
  }

  async *run(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    const profile = context.profileOverride ?? this.defaultProfile
    const maxTokens = this.#maxTokens === 0 ? undefined : this.#maxTokens

    // Seed conversation if fresh
    if (context.conversationHistory.length === 0) {
      const contextData = await this.#contextBuilder.getContextData()
      const systemContent = this.#renderSystemPrompt(contextData)
      await context.persistMessage({ role: 'system', content: systemContent })

      const taskContent = await this.#contextBuilder.buildUserTaskContent(task)
      await context.persistMessage({ role: 'user', content: taskContent })
    }

    const messages = [...context.conversationHistory]
    const llmResponse = await context.llm.complete({
      profile,
      messages,
      maxTokens
    })

    if (llmResponse.content) {
      await context.persistMessage({ role: 'assistant', content: llmResponse.content })
      yield { kind: 'text', content: llmResponse.content }
    }

    yield { kind: 'done', summary: llmResponse.content || 'Done' }
  }

  #renderSystemPrompt(data: ContextData): string {
    return MINIMAL_SYSTEM_PROMPT
      .replace('{{WORKING_DIRECTORY}}', data.env.workingDirectory)
      .replace('{{PLATFORM}}', data.env.platform)
      .replace('{{DATE}}', data.env.date)
  }
}
