import type { Agent, AgentContext, AgentOutput } from './agent.js'
import type { TaskView } from '../application/taskService.js'
import type { ContextBuilder } from '../application/contextBuilder.js'
import type { LLMMessage, LLMProfile } from '../domain/ports/llmClient.js'
import type { ToolGroup } from '../domain/ports/tool.js'
import type { ContextData } from '../domain/context.js'

// ============================================================================
// Base Tool Agent — Shared Tool-Loop Logic
// ============================================================================

/**
 * Abstract base for agents that use the standard tool loop:
 *   call LLM → yield tool calls → repeat until done or max iterations.
 *
 * Subclasses provide: id, displayName, description, toolGroups,
 * defaultProfile, system prompt template, and optional hooks.
 */
export abstract class BaseToolAgent implements Agent {
  abstract readonly id: string
  abstract readonly displayName: string
  abstract readonly description: string
  abstract readonly toolGroups: readonly ToolGroup[]
  abstract readonly defaultProfile: LLMProfile

  readonly #contextBuilder: ContextBuilder
  readonly #maxIterations: number
  readonly #maxTokens: number
  readonly #systemPromptTemplate: string

  constructor(opts: {
    contextBuilder: ContextBuilder
    maxIterations?: number
    maxTokens?: number
    systemPromptTemplate: string
  }) {
    this.#contextBuilder = opts.contextBuilder
    this.#maxIterations = opts.maxIterations ?? 50
    this.#maxTokens = opts.maxTokens ?? 4096
    this.#systemPromptTemplate = opts.systemPromptTemplate
  }

  async *run(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    yield* this.#toolLoop(task, context)
  }

  // ---------- main tool loop ----------

  async *#toolLoop(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    if (context.conversationHistory.length === 0) {
      const contextData = await this.#contextBuilder.getContextData()
      const systemContent = this.renderSystemPrompt(contextData)
      await context.persistMessage({ role: 'system', content: systemContent })

      const taskContent = await this.#contextBuilder.buildUserTaskContent(task)
      const userContent = `${taskContent}\n\n${this.getUserSuffix()}`
      await context.persistMessage({ role: 'user', content: userContent })
    }

    const profile = context.profileOverride ?? this.defaultProfile
    const maxTokens = this.#maxTokens === 0 ? undefined : this.#maxTokens

    let iteration = 0
    while (this.#maxIterations === 0 || iteration < this.#maxIterations) {
      iteration++
      yield { kind: 'verbose', content: `[Iteration ${iteration}] Calling LLM...` }

      const toolDefs = context.tools.list().map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))

      const messages: LLMMessage[] = [...context.conversationHistory]
      const llmResponse = context.onStreamChunk
        ? await context.llm.stream({ profile, messages, tools: toolDefs.length > 0 ? toolDefs : undefined, maxTokens }, context.onStreamChunk)
        : await context.llm.complete({ profile, messages, tools: toolDefs.length > 0 ? toolDefs : undefined, maxTokens })

      if (llmResponse.content || llmResponse.reasoning || llmResponse.toolCalls) {
        await context.persistMessage({
          role: 'assistant',
          content: llmResponse.content,
          reasoning: llmResponse.reasoning,
          toolCalls: llmResponse.toolCalls
        })

        if (llmResponse.reasoning) {
          yield { kind: 'reasoning', content: llmResponse.reasoning }
        }
        if (llmResponse.content) {
          yield { kind: 'text', content: llmResponse.content }
        }
      }

      if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
        yield { kind: 'done', summary: llmResponse.content || 'Task completed' }
        return
      }

      for (const toolCall of llmResponse.toolCalls) {
        const tool = context.tools.get(toolCall.toolName)
        if (!tool) {
          yield { kind: 'error', content: `Unknown tool: ${toolCall.toolName}` }
          continue
        }
        yield { kind: 'verbose', content: `Executing tool: ${toolCall.toolName}` }
        yield { kind: 'tool_call', call: toolCall }
      }
    }

    yield { kind: 'failed', reason: `Max iterations (${this.#maxIterations}) reached without completion` }
  }

  // ---------- prompt rendering (overridable) ----------

  /** Render the system prompt from template + context data. */
  protected renderSystemPrompt(data: ContextData): string {
    const parts: string[] = []

    const rendered = this.#systemPromptTemplate
      .replace('{{WORKING_DIRECTORY}}', data.env.workingDirectory)
      .replace('{{PLATFORM}}', data.env.platform)
      .replace('{{DATE}}', data.env.date)

    parts.push(rendered)

    if (data.project.outline) {
      parts.push(`\n## Project Outline\n${data.project.outline}`)
    }
    if (data.project.brief) {
      parts.push(`\n## Project Brief\n${data.project.brief}`)
    }
    if (data.project.style) {
      parts.push(`\n## Style Guide\n${data.project.style}`)
    }

    return parts.join('\n')
  }

  /** Suffix appended after the user task content. Override to customize. */
  protected getUserSuffix(): string {
    return 'Please analyze this task and use the available tools to complete it. When done, provide a summary of what was accomplished.'
  }
}
