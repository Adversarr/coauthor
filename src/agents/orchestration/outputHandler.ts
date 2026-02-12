import type { ToolCallRequest, ToolExecutor, ToolRegistry, ToolResult } from '../../core/ports/tool.js'
import type { ArtifactStore } from '../../core/ports/artifactStore.js'
import type { UiBus } from '../../core/ports/uiBus.js'
import type { TelemetrySink } from '../../core/ports/telemetry.js'
import type { DomainEvent } from '../../core/events/events.js'
import type { LLMMessage, LLMStreamChunk, LLMMessagePart } from '../../core/ports/llmClient.js'
import type { AgentOutput } from '../core/agent.js'
import type { ConversationManager } from './conversationManager.js'
import { buildConfirmInteraction } from '../display/displayBuilder.js'

// ============================================================================
// Output Handler
// ============================================================================

/**
 * Result returned after processing a single AgentOutput.
 *
 * - `event`    — domain event to persist (if any)
 * - `pause`    — true if execution should pause (awaiting user interaction)
 * - `terminal` — true if the task lifecycle ended (done / failed)
 */
export type OutputResult = {
  event?: DomainEvent
  pause?: boolean
  terminal?: boolean
}

/**
 * Mutable bag threaded through one agent-loop invocation.
 *
 * Keeps track of whether a risky-tool confirmation is still active so the
 * OutputHandler can clear it after use.
 */
export type OutputContext = {
  taskId: string
  agentId: string
  baseDir: string
  confirmedInteractionId?: string
  /**
   * The toolCallId that the confirmed interaction is bound to (SA-001).
   * When set, only the tool call with this exact ID may use the confirmation.
   */
  confirmedToolCallId?: string
  conversationHistory: readonly LLMMessage[]
  persistMessage: (m: LLMMessage) => Promise<void>
  /** AbortSignal propagated to tool execution for cooperative cancellation. */
  signal?: AbortSignal
  /** When true, text/reasoning are streamed via UiBus stream_delta events instead. */
  streamingEnabled?: boolean
}

/**
 * OutputHandler interprets each AgentOutput value yielded by an Agent
 * and converts it into side-effects (UI push, tool execution, domain events).
 *
 * Extracted from AgentRuntime so that:
 * - Runtime only orchestrates the event-loop and concurrency.
 * - Tool execution + result persistence lives in one focused place.
 * - Each output kind is easily testable in isolation.
 */
export class OutputHandler {
  readonly #toolExecutor: ToolExecutor
  readonly #toolRegistry: ToolRegistry
  readonly #artifactStore: ArtifactStore
  readonly #uiBus: UiBus | null
  readonly #conversationManager: ConversationManager
  readonly #telemetry: TelemetrySink

  constructor(opts: {
    toolExecutor: ToolExecutor
    toolRegistry: ToolRegistry
    artifactStore: ArtifactStore
    uiBus?: UiBus | null
    conversationManager: ConversationManager
    telemetry?: TelemetrySink
  }) {
    this.#toolExecutor = opts.toolExecutor
    this.#toolRegistry = opts.toolRegistry
    this.#artifactStore = opts.artifactStore
    this.#uiBus = opts.uiBus ?? null
    this.#conversationManager = opts.conversationManager
    this.#telemetry = opts.telemetry ?? { emit: () => {} }
  }

  /**
   * Process a single AgentOutput and return any resulting domain event.
   */
  async handle(output: AgentOutput, ctx: OutputContext): Promise<OutputResult> {
    switch (output.kind) {
      case 'text':
        if (!ctx.streamingEnabled) this.#emitUi(ctx, 'text', output.content)
        return {}

      case 'verbose':
        this.#emitUi(ctx, 'verbose', output.content)
        return {}

      case 'error':
        this.#emitUi(ctx, 'error', output.content)
        return {}

      case 'reasoning':
        if (!ctx.streamingEnabled) this.#emitUi(ctx, 'reasoning', output.content)
        return {}

      case 'tool_call': {
        const tool = this.#toolRegistry.get(output.call.toolName)
        
        const toolContext = {
          taskId: ctx.taskId,
          actorId: ctx.agentId,
          baseDir: ctx.baseDir,
          confirmedInteractionId: ctx.confirmedInteractionId,
          artifactStore: this.#artifactStore,
          signal: ctx.signal
        }

        // Universal Pre-Execution Check
        // If the tool implements canExecute, run it first.
        // If it fails, we skip risk checks and execution, returning the error immediately.
        if (tool?.canExecute) {
          try {
            await tool.canExecute(output.call.arguments, toolContext)
          } catch (error) {
            const errMessage = error instanceof Error ? error.message : String(error)
            
            await this.#conversationManager.persistToolResultIfMissing(
              ctx.taskId,
              output.call.toolCallId,
              output.call.toolName,
              { error: errMessage },
              true,
              ctx.conversationHistory,
              ctx.persistMessage
            )
            return {}
          }
        }

        const isRisky = tool?.riskLevel === 'risky'

        // Risky tool: needs confirmation. Either unconfirmed, or confirmed
        // for a different tool call (SA-001 — approval must be action-bound).
        const needsConfirmation = isRisky && (
          !ctx.confirmedInteractionId ||
          (ctx.confirmedToolCallId && ctx.confirmedToolCallId !== output.call.toolCallId)
        )

        if (needsConfirmation) {
          const confirmReq = buildConfirmInteraction(output.call)
          const event: DomainEvent = {
            type: 'UserInteractionRequested',
            payload: {
              taskId: ctx.taskId,
              interactionId: confirmReq.interactionId,
              kind: confirmReq.kind,
              purpose: confirmReq.purpose,
              display: confirmReq.display,
              options: confirmReq.options,
              validation: confirmReq.validation,
              authorActorId: ctx.agentId
            }
          }
          return { event, pause: true }
        }

        // Emit tool_call_start UiEvent so the frontend can show real-time tool activity
        this.#uiBus?.emit({
          type: 'tool_call_start',
          payload: {
            taskId: ctx.taskId,
            agentId: ctx.agentId,
            toolCallId: output.call.toolCallId,
            toolName: output.call.toolName,
            arguments: output.call.arguments,
          }
        })

        const startMs = Date.now()
        const result: ToolResult = await this.#toolExecutor.execute(output.call, toolContext)
        const durationMs = Date.now() - startMs

        // Emit tool_call_end UiEvent with result
        this.#uiBus?.emit({
          type: 'tool_call_end',
          payload: {
            taskId: ctx.taskId,
            agentId: ctx.agentId,
            toolCallId: output.call.toolCallId,
            toolName: output.call.toolName,
            output: result.output,
            isError: result.isError,
            durationMs,
          }
        })

        // Persist into conversation (idempotent)
        await this.#conversationManager.persistToolResultIfMissing(
          ctx.taskId,
          output.call.toolCallId,
          output.call.toolName,
          result.output,
          result.isError,
          ctx.conversationHistory,
          ctx.persistMessage
        )

        if (isRisky) {
          // Clear the one-time confirmation after use
          ctx.confirmedInteractionId = undefined
          ctx.confirmedToolCallId = undefined
        }

        return {}
      }

      case 'interaction': {
        const event: DomainEvent = {
          type: 'UserInteractionRequested',
          payload: {
            taskId: ctx.taskId,
            interactionId: output.request.interactionId,
            kind: output.request.kind,
            purpose: output.request.purpose,
            display: output.request.display,
            options: output.request.options,
            validation: output.request.validation,
            authorActorId: ctx.agentId
          }
        }
        return { event, pause: true }
      }

      case 'done': {
        const event: DomainEvent = {
          type: 'TaskCompleted',
          payload: {
            taskId: ctx.taskId,
            summary: output.summary,
            authorActorId: ctx.agentId
          }
        }
        return { event, terminal: true }
      }

      case 'failed': {
        const event: DomainEvent = {
          type: 'TaskFailed',
          payload: {
            taskId: ctx.taskId,
            reason: output.reason,
            authorActorId: ctx.agentId
          }
        }
        return { event, terminal: true }
      }

      default: {
        const _exhaustive: never = output
        return _exhaustive
      }
    }
  }

  // ---------- rejection handling ----------

  /**
   * Record rejection results for dangling risky tool calls.
   *
   * Called before agent.run() when the user rejected a risky tool confirmation.
   * Only the tool call bound to the rejected interaction should be rejected.
   */
  async handleRejections(ctx: OutputContext, targetToolCallId?: string): Promise<void> {
    if (!targetToolCallId) return

    const pendingCalls = this.#conversationManager.getPendingToolCalls(ctx.conversationHistory)
    const rejectedCalls = pendingCalls.filter((call) => call.toolCallId === targetToolCallId)
    if (rejectedCalls.length === 0) return

    const toolContext = {
      taskId: ctx.taskId,
      actorId: ctx.agentId,
      baseDir: ctx.baseDir,
      artifactStore: this.#artifactStore
    }

    for (const call of rejectedCalls) {
      const tool = this.#toolRegistry.get(call.toolName)
      if (tool?.riskLevel !== 'risky') continue

      const result = this.#toolExecutor.recordRejection(call, toolContext)
      await this.#conversationManager.persistToolResultIfMissing(
        ctx.taskId,
        call.toolCallId,
        call.toolName,
        result.output,
        result.isError,
        ctx.conversationHistory,
        ctx.persistMessage
      )
    }
  }

  // ---------- streaming ----------

  /**
   * Create a callback for `LLMClient.stream()` that forwards text/reasoning
   * deltas to the UiBus as `stream_delta` events, while accumulating an ordered
   * `parts` array that captures the true interleaved output sequence.
   * Emits `stream_end` on the `done` chunk.
   *
   * Returns both the callback and a `getParts()` accessor for the accumulated parts array.
   */
  createStreamChunkHandler(ctx: OutputContext): {
    onChunk: (chunk: LLMStreamChunk) => void
    getParts: () => LLMMessagePart[]
  } {
    const parts: LLMMessagePart[] = []
    let currentKind: 'text' | 'reasoning' | null = null

    const onChunk = (chunk: LLMStreamChunk) => {
      if (chunk.type === 'text') {
        this.#uiBus?.emit({
          type: 'stream_delta',
          payload: { taskId: ctx.taskId, agentId: ctx.agentId, kind: 'text', content: chunk.content }
        })
        // Accumulate into ordered parts array — merge consecutive same-kind
        if (currentKind === 'text' && parts.length > 0) {
          const last = parts[parts.length - 1]!
          if (last.kind === 'text') {
            last.content += chunk.content
          }
        } else {
          parts.push({ kind: 'text', content: chunk.content })
          currentKind = 'text'
        }
      } else if (chunk.type === 'reasoning') {
        this.#uiBus?.emit({
          type: 'stream_delta',
          payload: { taskId: ctx.taskId, agentId: ctx.agentId, kind: 'reasoning', content: chunk.content }
        })
        if (currentKind === 'reasoning' && parts.length > 0) {
          const last = parts[parts.length - 1]!
          if (last.kind === 'reasoning') {
            last.content += chunk.content
          }
        } else {
          parts.push({ kind: 'reasoning', content: chunk.content })
          currentKind = 'reasoning'
        }
      } else if (chunk.type === 'tool_call_start') {
        parts.push({
          kind: 'tool_call',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          arguments: {},
        })
        currentKind = null
      } else if (chunk.type === 'done') {
        this.#uiBus?.emit({
          type: 'stream_end',
          payload: { taskId: ctx.taskId, agentId: ctx.agentId }
        })
      }
      // tool_call_delta/end: arguments are accumulated by the LLM client,
      // the complete arguments will be available in LLMResponse.toolCalls
    }

    return { onChunk, getParts: () => parts }
  }

  // ---------- internals ----------

  #emitUi(ctx: OutputContext, kind: 'text' | 'verbose' | 'error' | 'reasoning', content: string): void {
    this.#uiBus?.emit({
      type: 'agent_output',
      payload: { taskId: ctx.taskId, agentId: ctx.agentId, kind, content }
    })
  }
}
