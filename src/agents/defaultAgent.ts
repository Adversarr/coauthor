import type { Agent, AgentContext, AgentOutput } from './agent.js'
import type { TaskView } from '../application/taskService.js'
import type { ContextBuilder } from '../application/contextBuilder.js'
import type { LLMMessage } from '../domain/ports/llmClient.js'
import type { ToolCallRequest } from '../domain/ports/tool.js'
import { DEFAULT_COAUTHOR_SYSTEM_PROMPT } from './templates.js'
import type { ContextData } from '../domain/context.js'

// ============================================================================
// Default CoAuthor Agent - Tool Use Workflow
// ============================================================================

/**
 * Default CoAuthor Agent.
 *
 * Implements the Tool Use workflow:
 * 1. Enter tool loop: call LLM → yield tool calls → repeat
 * 2. Complete or fail task
 *
 * The agent is risk-unaware. It yields `{ kind: 'tool_call' }` for every
 * tool. The Runtime/OutputHandler intercepts risky tools and handles UIP
 * confirmation before execution — agents never need to know about risk.
 */
export class DefaultCoAuthorAgent implements Agent {
  readonly id = 'agent_coauthor_default'
  readonly displayName = 'CoAuthor Default Agent'
  readonly description =
    'General-purpose agent that uses available tools to analyze tasks, edit files, and execute commands.'

  readonly #contextBuilder: ContextBuilder
  readonly #maxIterations: number
  readonly #systemPromptTemplate: string

  constructor(opts: { contextBuilder: ContextBuilder; maxIterations?: number; systemPromptTemplate?: string }) {
    this.#contextBuilder = opts.contextBuilder
    this.#maxIterations = opts.maxIterations ?? 50
    this.#systemPromptTemplate = opts.systemPromptTemplate ?? DEFAULT_COAUTHOR_SYSTEM_PROMPT
  }

  async *run(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    yield* this.#toolLoop(task, context)
  }

  // ---------- main tool loop ----------

  /**
   * Main tool execution loop.
   * Calls LLM, yields tool calls, repeats until done or max iterations.
   */
  async *#toolLoop(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    // Seed conversation if fresh
    if (context.conversationHistory.length === 0) {
      // 1. System Prompt (rendered from template + context data)
      const contextData = await this.#contextBuilder.getContextData()
      const systemContent = this.#renderSystemPrompt(contextData)
      await context.persistMessage({ role: 'system', content: systemContent })

      // 2. User Task (content from builder + specific instructions)
      const taskContent = await this.#contextBuilder.buildUserTaskContent(task)
      const userContent = `${taskContent}\n\nPlease analyze this task and use the available tools to complete it. When done, provide a summary of what was accomplished.`
      
      await context.persistMessage({ role: 'user', content: userContent })
    }

    let iteration = 0
    while (iteration < this.#maxIterations) {
      iteration++
      yield { kind: 'verbose', content: `[Iteration ${iteration}] Calling LLM...` }

      const toolDefs = context.tools.list().map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))

      const messages: LLMMessage[] = [...context.conversationHistory]
      const llmResponse = await context.llm.complete({
        profile: 'fast',
        messages,
        tools: toolDefs,
        maxTokens: 4096
      })

      // Persist assistant message
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

      // No tool calls → done
      if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
        yield { kind: 'done', summary: llmResponse.content || 'Task completed' }
        return
      }

      // Process tool calls — agent is risk-unaware, just yield them all
      for (const toolCall of llmResponse.toolCalls) {
        const tool = context.tools.get(toolCall.toolName)
        if (!tool) {
          yield { kind: 'error', content: `Unknown tool: ${toolCall.toolName}` }
          continue
        }

        yield* this.#executeToolCall(toolCall)
      }
    }

    yield { kind: 'failed', reason: `Max iterations (${this.#maxIterations}) reached without completion` }
  }

  // ---------- tool call ----------

  /**
   * Yield a tool call for execution by the Runtime.
   *
   * The Runtime handles execution and result persistence.
   * The agent just signals intent.
   */
  async *#executeToolCall(toolCall: ToolCallRequest): AsyncGenerator<AgentOutput> {
    yield { kind: 'verbose', content: `Executing tool: ${toolCall.toolName}` }
    yield { kind: 'tool_call', call: toolCall }
  }

  // ---------- prompt rendering ----------

  #renderSystemPrompt(data: ContextData): string {
    const parts: string[] = []

    // Replace environment placeholders
    const rendered = this.#systemPromptTemplate
      .replace('{{WORKING_DIRECTORY}}', data.env.workingDirectory)
      .replace('{{PLATFORM}}', data.env.platform)
      .replace('{{DATE}}', data.env.date)
    
    parts.push(rendered)

    // Append project-specific context
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
}

