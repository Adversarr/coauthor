import type { ToolExecutor, ToolRegistry, ToolResult } from '../domain/ports/tool.js'
import type { ArtifactStore } from '../domain/ports/artifactStore.js'
import type { UiBus } from '../domain/ports/uiBus.js'
import type { TelemetrySink } from '../domain/ports/telemetry.js'
import type { DomainEvent } from '../domain/events.js'
import type { LLMMessage } from '../domain/ports/llmClient.js'
import type { AgentOutput } from './agent.js'
import type { ConversationManager } from './conversationManager.js'
import { buildConfirmInteraction } from './displayBuilder.js'

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
  conversationHistory: readonly LLMMessage[]
  persistMessage: (m: LLMMessage) => void
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
        this.#emitUi(ctx, 'text', output.content)
        return {}

      case 'verbose':
        this.#emitUi(ctx, 'verbose', output.content)
        return {}

      case 'error':
        this.#emitUi(ctx, 'error', output.content)
        return {}

      case 'reasoning':
        this.#emitUi(ctx, 'reasoning', output.content)
        return {}

      case 'tool_call': {
        const tool = this.#toolRegistry.get(output.call.toolName)
        
        const toolContext = {
          taskId: ctx.taskId,
          actorId: ctx.agentId,
          baseDir: ctx.baseDir,
          confirmedInteractionId: ctx.confirmedInteractionId,
          artifactStore: this.#artifactStore
        }

        // Universal Pre-Execution Check
        // If the tool implements canExecute, run it first.
        // If it fails, we skip risk checks and execution, returning the error immediately.
        if (tool?.canExecute) {
          try {
            await tool.canExecute(output.call.arguments, toolContext)
          } catch (error) {
            const errMessage = error instanceof Error ? error.message : String(error)
            
            this.#conversationManager.persistToolResultIfMissing(
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

        // Risky tool without confirmation → emit UIP request, pause execution
        if (isRisky && !ctx.confirmedInteractionId) {
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

        const result: ToolResult = await this.#toolExecutor.execute(output.call, toolContext)

        // Persist into conversation (idempotent)
        this.#conversationManager.persistToolResultIfMissing(
          ctx.taskId,
          output.call.toolCallId,
          output.call.toolName,
          result.output,
          result.isError,
          ctx.conversationHistory,
          ctx.persistMessage
        )

        if (isRisky) {
          ctx.confirmedInteractionId = undefined
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

  // ---------- internals ----------

  #emitUi(ctx: OutputContext, kind: 'text' | 'verbose' | 'error' | 'reasoning', content: string): void {
    this.#uiBus?.emit({
      type: 'agent_output',
      payload: { taskId: ctx.taskId, agentId: ctx.agentId, kind, content }
    })
  }
}
