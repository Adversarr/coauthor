import type { Agent, AgentContext, AgentOutput } from './agent.js'
import type { TaskView } from '../application/taskService.js'
import type { ContextBuilder } from '../application/contextBuilder.js'
import type { LLMMessage } from '../domain/ports/llmClient.js'
import type { ToolCallRequest } from '../domain/ports/tool.js'

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

  constructor(opts: { contextBuilder: ContextBuilder; maxIterations?: number }) {
    this.#contextBuilder = opts.contextBuilder
    this.#maxIterations = opts.maxIterations ?? 50
  }

  async *run(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    yield* this.#toolLoop(task, context)
  }

  // ---------- pending tool calls (resume after pause / UIP) ----------

  /**
   * Process any pending tool calls from previous execution (e.g. after resume).
   *
   * The agent is risk-unaware — it simply yields `tool_call` for every
   * pending call. The Runtime/OutputHandler handles UIP confirmation.
   * Rejection results are already injected into history by Runtime before
   * agent.run() is called, so we only re-execute calls with no result.
   */
  async *#processPendingToolCalls(context: AgentContext): AsyncGenerator<AgentOutput> {
    const lastMessage = context.conversationHistory[context.conversationHistory.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant' || !lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
      return
    }

    const pendingCalls = lastMessage.toolCalls.filter(tc =>
      !context.conversationHistory.some(
        m => m.role === 'tool' && m.toolCallId === tc.toolCallId
      )
    )
    if (pendingCalls.length === 0) return

    for (const toolCall of pendingCalls) {
      const tool = context.tools.get(toolCall.toolName)
      if (!tool) {
        yield { kind: 'error', content: `Unknown tool in pending call: ${toolCall.toolName}` }
        continue
      }

      yield* this.#executeToolCall(toolCall)
    }
  }

  // ---------- main tool loop ----------

  /**
   * Main tool execution loop.
   * Calls LLM, yields tool calls, repeats until done or max iterations.
   */
  async *#toolLoop(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    // Seed conversation if fresh
    if (context.conversationHistory.length === 0) {
      await context.persistMessage({ role: 'system', content: await this.#contextBuilder.buildSystemPrompt() })
      await context.persistMessage({ role: 'user', content: this.#buildTaskPrompt(task) })
    }

    // Process any pending tool calls from previous execution
    yield* this.#processPendingToolCalls(context)

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

  // ---------- prompt building ----------

  #buildTaskPrompt(task: TaskView): string {
    let prompt = `# Task\n\n**Title:** ${task.title}\n\n`

    if (task.intent) {
      prompt += `**Intent:**\n${task.intent}\n\n`
    }

    if (task.artifactRefs && task.artifactRefs.length > 0) {
      prompt += `**Referenced Files:**\n`
      for (const ref of task.artifactRefs) {
        if (typeof ref === 'object' && 'path' in ref) {
          prompt += `- ${ref.path}\n`
        } else {
          prompt += `- ${JSON.stringify(ref)}\n`
        }
      }
      prompt += '\n'
    }

    prompt += `Please analyze this task and use the available tools to complete it. When done, provide a summary of what was accomplished.`
    return prompt
  }
}
