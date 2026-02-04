import { nanoid } from 'nanoid'
import type { Agent, AgentContext, AgentOutput, AgentInteractionRequest } from './agent.js'
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
 * This is the V1 agent implementing the UIP + Tool Use workflow:
 * 1. Enter tool loop: call LLM → execute tools → repeat
 * 2. Handle risky tools via UIP confirmation
 * 3. Complete or fail task
 *
 * Conversation history is managed by AgentRuntime via ConversationStore.
 * The agent uses context.conversationHistory (pre-loaded) and
 * context.persistMessage() to add new messages for crash recovery.
 */
export class DefaultCoAuthorAgent implements Agent {
  readonly id = 'agent_coauthor_default'
  readonly displayName = 'CoAuthor Default Agent'

  readonly #contextBuilder: ContextBuilder
  readonly #maxIterations: number

  constructor(opts: { contextBuilder: ContextBuilder; maxIterations?: number }) {
    this.#contextBuilder = opts.contextBuilder
    this.#maxIterations = opts.maxIterations ?? 50
  }

  async *run(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    yield* this.#toolLoop(task, context)
  }

  /**
   * Main tool execution loop.
   * Calls LLM, executes tool calls, repeats until done.
   *
   * Uses context.conversationHistory directly (pre-loaded from ConversationStore).
   * Persists new messages via context.persistMessage() for crash recovery.
   */
  async *#toolLoop(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    // Build messages array from persisted history
    const systemPrompt = this.#contextBuilder.buildSystemPrompt()
    
    // Start with system + user prompts if no history exists
    if (context.conversationHistory.length === 0) {
      context.persistMessage({ role: 'system', content: systemPrompt })
      context.persistMessage({ role: 'user', content: this.#buildTaskPrompt(task) })
    }

    // Build current messages from persisted history
    const getMessages = (): LLMMessage[] => [...context.conversationHistory]

    // Add any pending tool results from current execution
    // (These are from tool calls made in this run, before a pause)
    if (context.toolResults.size > 0) {
      for (const [callId, result] of context.toolResults) {
        // Check if this tool result is already in history
        const alreadyExists = context.conversationHistory.some(
          m => m.role === 'tool' && 'toolCallId' in m && m.toolCallId === callId
        )
        if (!alreadyExists) {
          const toolMessage: LLMMessage = {
            role: 'tool',
            content: JSON.stringify(result.output),
            toolCallId: callId
          }
          context.persistMessage(toolMessage)
        }
      }
    }

    let iteration = 0
    while (iteration < this.#maxIterations) {
      iteration++
      yield { kind: 'text', content: `[Iteration ${iteration}] Calling LLM...` }

      // Get tool definitions for LLM
      const toolDefs = context.tools.list().map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))

      // Call LLM with current messages
      const messages = getMessages()
      const llmResponse = await context.llm.complete({
        profile: 'fast',
        messages,
        tools: toolDefs,
        maxTokens: 4096
      })

      // Handle text response - persist immediately for crash recovery
      if (llmResponse.content || llmResponse.toolCalls) {
        const assistantMessage: LLMMessage = {
          role: 'assistant',
          content: llmResponse.content,
          toolCalls: llmResponse.toolCalls
        }
        context.persistMessage(assistantMessage)
        
        if (llmResponse.content) {
          yield { kind: 'text', content: llmResponse.content }
        }
      }

      // No tool calls means agent is done
      if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
        yield { 
          kind: 'done', 
          summary: llmResponse.content || 'Task completed' 
        }
        return
      }

      // Process tool calls
      for (const toolCall of llmResponse.toolCalls) {
        const tool = context.tools.get(toolCall.toolName)
        if (!tool) {
          yield { kind: 'text', content: `Unknown tool: ${toolCall.toolName}` }
          continue
        }

        // Check if tool is risky and needs confirmation
        if (tool.riskLevel === 'risky') {
          // Check if we have confirmation for this interaction
          if (context.confirmedInteractionId) {
            // We have confirmation, execute the tool
            yield* this.#executeToolCall(toolCall, context)
          } else {
            // Need to request confirmation
            const confirmRequest: AgentInteractionRequest = {
              interactionId: `ui_${nanoid(12)}`,
              kind: 'Confirm',
              purpose: 'confirm_risky_action',
              display: {
                title: 'Confirm Risky Operation',
                description: this.#formatRiskyToolConfirmation(toolCall)
              },
              options: [
                { id: 'approve', label: 'Approve', style: 'danger' },
                { id: 'reject', label: 'Reject', style: 'default', isDefault: true }
              ]
            }
            yield { kind: 'interaction', request: confirmRequest }
            return // Pause for confirmation
          }
        } else {
          // Execute safe tool
          yield* this.#executeToolCall(toolCall, context)
        }
      }
    }

    // Max iterations reached
    yield { 
      kind: 'failed', 
      reason: `Max iterations (${this.#maxIterations}) reached without completion` 
    }
  }

  /**
   * Execute a single tool call and yield results.
   * Persists tool result message for crash recovery.
   */
  async *#executeToolCall(
    toolCall: ToolCallRequest,
    context: AgentContext
  ): AsyncGenerator<AgentOutput> {
    yield { kind: 'text', content: `Executing tool: ${toolCall.toolName}` }
    yield { kind: 'tool_call', call: toolCall }

    // Get result (injected by runtime)
    const result = context.toolResults.get(toolCall.toolCallId)
    if (result) {
      // Persist tool result message for crash recovery
      const toolMessage: LLMMessage = {
        role: 'tool',
        content: JSON.stringify(result.output),
        toolCallId: toolCall.toolCallId
      }
      context.persistMessage(toolMessage)
      
      if (result.isError) {
        yield { kind: 'text', content: `Tool failed: ${JSON.stringify(result.output)}` }
      }
    }
  }

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

  #formatRiskyToolConfirmation(toolCall: ToolCallRequest): string {
    const argsPreview = JSON.stringify(toolCall.arguments, null, 2)
    return `The agent wants to execute a potentially risky operation:

**Tool:** ${toolCall.toolName}

**Arguments:**
\`\`\`json
${argsPreview}
\`\`\`

Do you want to allow this operation?`
  }
}
