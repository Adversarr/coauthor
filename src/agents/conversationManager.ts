import type { ConversationStore } from '../domain/ports/conversationStore.js'
import type { AuditLog } from '../domain/ports/auditLog.js'
import type { ToolRegistry, ToolExecutor, ToolCallRequest } from '../domain/ports/tool.js'
import type { ArtifactStore } from '../domain/ports/artifactStore.js'
import type { TelemetrySink } from '../domain/ports/telemetry.js'
import type { LLMMessage } from '../domain/ports/llmClient.js'

// ============================================================================
// Conversation Manager
// ============================================================================

/**
 * ConversationManager owns all conversation-state operations:
 *
 * - Loading & repairing history from ConversationStore + AuditLog
 * - Checking whether history is in a "safe" state for injection
 * - Draining queued user instructions into history when safe
 * - Creating the `persistMessage` callback for AgentContext
 *
 * Extracted from AgentRuntime to keep conversation management testable
 * and separate from event-handling / concurrency concerns.
 */
export class ConversationManager {
  readonly #conversationStore: ConversationStore
  readonly #auditLog: AuditLog
  readonly #toolRegistry: ToolRegistry
  readonly #toolExecutor: ToolExecutor
  readonly #artifactStore: ArtifactStore
  readonly #telemetry: TelemetrySink

  constructor(opts: {
    conversationStore: ConversationStore
    auditLog: AuditLog
    toolRegistry: ToolRegistry
    toolExecutor: ToolExecutor
    artifactStore: ArtifactStore
    telemetry?: TelemetrySink
  }) {
    this.#conversationStore = opts.conversationStore
    this.#auditLog = opts.auditLog
    this.#toolRegistry = opts.toolRegistry
    this.#toolExecutor = opts.toolExecutor
    this.#artifactStore = opts.artifactStore
    this.#telemetry = opts.telemetry ?? { emit: () => {} }
  }

  // ---------- public helpers exposed to Runtime ----------

  /** Underlying store (needed by Runtime for raw append in event handler). */
  get store(): ConversationStore {
    return this.#conversationStore
  }

  // ---------- load & repair ----------

  /**
   * Load conversation history for a task and repair any dangling tool calls.
   *
   * Repair strategy (per dangling tool call):
   * 1. If AuditLog has a ToolCallCompleted entry → re-inject the result.
   * 2. If the tool is unknown → close with an "interrupted (Unknown tool)" error.
   * 3. If the tool is safe → re-execute and inject the result.
   * 4. If the tool is risky → leave dangling (Agent will re-request confirmation).
   */
  async loadAndRepair(
    taskId: string,
    agentId: string,
    baseDir: string
  ): Promise<LLMMessage[]> {
    const history: LLMMessage[] = await this.#conversationStore.getMessages(taskId)
    await this.#repairDanglingToolCalls(taskId, agentId, baseDir, history)
    return history
  }

  // ---------- safety check ----------

  /**
   * Check if conversation history is in a "safe" state — i.e. every
   * assistant tool call has a corresponding tool-result message.
   *
   * Safe means it is okay to:
   * - Inject a new user message (instruction)
   * - Pause execution
   */
  isSafeToInject(history: readonly LLMMessage[]): boolean {
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i]
      if (msg.role === 'user') return true

      if (msg.role === 'assistant') {
        if (!msg.toolCalls || msg.toolCalls.length === 0) return true

        const pendingCallIds = new Set(msg.toolCalls.map(c => c.toolCallId))

        for (let j = i + 1; j < history.length; j++) {
          const next = history[j]
          if (next.role === 'tool') {
            pendingCallIds.delete(next.toolCallId)
          }
        }

        return pendingCallIds.size === 0
      }
    }
    return true
  }

  // ---------- pending tool calls ----------

  /**
   * Identify pending tool calls in the conversation history.
   *
   * A tool call is pending if:
   * 1. It belongs to the last assistant message in the history.
   * 2. It does not have a corresponding tool result in the subsequent messages.
   */
  getPendingToolCalls(history: readonly LLMMessage[]): ToolCallRequest[] {
    let lastAssistantMessage: LLMMessage | undefined
    let lastAssistantIndex = -1

    // Find the last assistant message
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant') {
        lastAssistantMessage = history[i]
        lastAssistantIndex = i
        break
      }
    }

    if (!lastAssistantMessage || lastAssistantMessage.role !== 'assistant' || !lastAssistantMessage.toolCalls || lastAssistantMessage.toolCalls.length === 0) {
      return []
    }

    // Collect IDs of tools that have already run (appear after the assistant message)
    const handledToolCallIds = new Set<string>()
    for (let i = lastAssistantIndex + 1; i < history.length; i++) {
      const msg = history[i]
      if (msg.role === 'tool') {
        handledToolCallIds.add(msg.toolCallId)
      }
    }

    // Return only the unhandled ones
    return lastAssistantMessage.toolCalls.filter(
      (tc) => !handledToolCallIds.has(tc.toolCallId)
    )
  }

  // ---------- persist callback factory ----------

  /**
   * Create the `persistMessage` callback wired to a specific task.
   *
   * The callback writes to both the durable ConversationStore AND the
   * in-memory `history` array so callers always see the latest state.
   */
  createPersistCallback(
    taskId: string,
    history: LLMMessage[]
  ): (message: LLMMessage) => Promise<void> {
    return async (message: LLMMessage) => {
      await this.#conversationStore.append(taskId, message)
      history.push(message)
    }
  }

  // ---------- tool-result persistence ----------

  /**
   * Persist a tool result into the conversation if not already present.
   *
   * This is called by the OutputHandler after tool execution so that
   * tool results are durably recorded for crash recovery.
   */
  async persistToolResultIfMissing(
    taskId: string,
    toolCallId: string,
    toolName: string,
    resultOutput: unknown,
    isError: boolean,
    history: readonly LLMMessage[],
    persistMessage: (m: LLMMessage) => Promise<void>
  ): Promise<void> {
    const alreadyExists = history.some(
      (m) => m.role === 'tool' && m.toolCallId === toolCallId
    )
    if (alreadyExists) return

    await persistMessage({
      role: 'tool',
      toolCallId,
      toolName,
      content: JSON.stringify(resultOutput),
    })
    this.#telemetry.emit({
      type: 'tool_result_persisted',
      payload: { taskId, toolCallId, toolName, isError },
    })
  }

  // ---------- instruction queue ----------

  /**
   * Drain a queue of pending user instructions into conversation history
   * when the history is in a safe state.
   */
  async drainPendingInstructions(
    queue: string[],
    history: readonly LLMMessage[],
    persistMessage: (m: LLMMessage) => Promise<void>
  ): Promise<void> {
    if (queue.length === 0) return
    if (!this.isSafeToInject(history)) return

    while (queue.length > 0) {
      const instruction = queue.shift()
      if (instruction) {
        await persistMessage({ role: 'user', content: instruction })
      }
    }
  }

  // ---------- internals ----------

  async #repairDanglingToolCalls(
    taskId: string,
    agentId: string,
    baseDir: string,
    history: LLMMessage[]
  ): Promise<void> {
    // console.log('[DEBUG] repairing history for', taskId, 'length:', history.length)

    // Collect existing tool-result IDs
    const existingToolResults = new Set<string>()
    for (const message of history) {
      if (message.role === 'tool') {
        existingToolResults.add(message.toolCallId)
      }
    }

    // Collect all requested tool calls
    const desiredToolCalls: Array<{
      toolCallId: string
      toolName: string
      arguments: Record<string, unknown>
    }> = []
    for (const message of history) {
      if (message.role !== 'assistant') continue
      for (const tc of message.toolCalls ?? []) {
        desiredToolCalls.push({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          arguments: tc.arguments,
        })
      }
    }

    if (desiredToolCalls.length === 0) return

    // Build lookup from AuditLog completions
    const auditEntries = await this.#auditLog.readByTask(taskId)
    const toolCompletionById = new Map<
      string,
      { toolName: string; output: unknown; isError: boolean }
    >()
    for (const entry of auditEntries) {
      if (entry.type !== 'ToolCallCompleted') continue
      toolCompletionById.set(entry.payload.toolCallId, {
        toolName: entry.payload.toolName,
        output: entry.payload.output,
        isError: entry.payload.isError,
      })
    }

    let repairedToolResults = 0
    let retriedToolCalls = 0

    for (const toolCall of desiredToolCalls) {
      if (existingToolResults.has(toolCall.toolCallId)) continue

      // Strategy 1: recover from AuditLog
      const completed = toolCompletionById.get(toolCall.toolCallId)
      if (completed) {
        const msg: LLMMessage = {
          role: 'tool',
          toolCallId: toolCall.toolCallId,
          toolName: completed.toolName,
          content: JSON.stringify(completed.output),
        }
        await this.#conversationStore.append(taskId, msg)
        history.push(msg)
        existingToolResults.add(toolCall.toolCallId)
        repairedToolResults += 1
        continue
      }

      const tool = this.#toolRegistry.get(toolCall.toolName)

      // Strategy 2: unknown tool → close with error
      if (!tool) {
        const msg: LLMMessage = {
          role: 'tool',
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          content: JSON.stringify({
            isError: true,
            error: 'Tool execution interrupted (Unknown tool)',
          }),
        }
        await this.#conversationStore.append(taskId, msg)
        history.push(msg)
        existingToolResults.add(toolCall.toolCallId)
        repairedToolResults += 1
        continue
      }

      // Strategy 4: risky tool → leave dangling for Agent to handle
      if (tool.riskLevel !== 'safe') {
        continue
      }

      // Strategy 3: safe tool → re-execute
      const retryResult = await this.#toolExecutor.execute(
        {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          arguments: toolCall.arguments,
        },
        {
          taskId,
          actorId: agentId,
          baseDir,
          artifactStore: this.#artifactStore,
        }
      )

      const msg: LLMMessage = {
        role: 'tool',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        content: JSON.stringify(retryResult.output),
      }
      await this.#conversationStore.append(taskId, msg)
      history.push(msg)
      existingToolResults.add(toolCall.toolCallId)
      retriedToolCalls += 1
    }

    if (repairedToolResults > 0 || retriedToolCalls > 0) {
      this.#telemetry.emit({
        type: 'conversation_repair_applied',
        payload: { taskId, repairedToolResults, retriedToolCalls },
      })
    }
  }
}
