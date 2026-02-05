import type { UserInteractionRespondedPayload } from '../domain/events.js'
import type { TaskView } from '../application/taskService.js'
import type { LLMClient, LLMMessage } from '../domain/ports/llmClient.js'
import type { ToolRegistry, ToolCallRequest, ToolResult } from '../domain/ports/tool.js'
import type { InteractionRequest } from '../application/interactionService.js'

// ============================================================================
// Agent Interaction Request
// ============================================================================

/**
 * Agent interaction request - includes interactionId for tracking.
 * This is emitted by agents and converted to UIP events by the runtime.
 */
export type AgentInteractionRequest = InteractionRequest & {
  interactionId: string
}

// ============================================================================
// Agent Output Types
// ============================================================================

/**
 * AgentOutput represents what an Agent yields during execution.
 * The AgentRuntime interprets these outputs and takes appropriate actions.
 */
export type AgentOutput =
  | { kind: 'text'; content: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'tool_call'; call: ToolCallRequest }
  | { kind: 'interaction'; request: AgentInteractionRequest }
  | { kind: 'done'; summary?: string }
  | { kind: 'failed'; reason: string }

// ============================================================================
// Agent Context
// ============================================================================

/**
 * Context provided to an Agent when running a task.
 * Contains all dependencies needed for task execution.
 *
 * The Runtime manages conversation persistence via ConversationStore.
 * Agents should use `persistMessage()` to add messages to history,
 * which ensures they are both persisted and available in `conversationHistory`.
 */
export type AgentContext = {
  /** LLM client for generating responses */
  readonly llm: LLMClient
  
  /** Tool registry for accessing available tools */
  readonly tools: ToolRegistry
  
  /** Base directory of the workspace */
  readonly baseDir: string
  
  /**
   * Conversation history for multi-turn interactions.
   * Pre-loaded from ConversationStore by Runtime on start/resume.
   * Use `persistMessage()` to add new messages.
   */
  readonly conversationHistory: readonly LLMMessage[]
  
  /** Response to a pending interaction (if resuming) */
  readonly pendingInteractionResponse?: UserInteractionRespondedPayload
  
  /** Results from tool calls (injected by runtime) */
  readonly toolResults: Map<string, ToolResult>
  
  /**
   * Confirmed interaction ID for risky tool execution.
   * Set when resuming after a confirm_risky_action UIP response.
   */
  confirmedInteractionId?: string

  /**
   * Persist a message to conversation history.
   * Call this after each LLM response or tool result to ensure
   * the message survives pauses, restarts, and crashes.
   */
  persistMessage(message: LLMMessage): void
}

// ============================================================================
// Agent Interface
// ============================================================================

/**
 * Agent interface - a strategy unit for handling tasks.
 *
 * Agents are NOT persistent listeners. They are instantiated/invoked
 * when a task is assigned to them. Different agents differ in:
 * - Their prompt strategies
 * - Their internal workflow logic
 *
 * Tasks are assigned an agentId at creation time.
 */
export interface Agent {
  /** Unique identifier for this agent */
  readonly id: string

  /** Human-readable display name */
  readonly displayName: string

  /**
   * Execute the task workflow.
   *
   * Yields AgentOutput as the agent progresses through its workflow.
   * The AgentRuntime handles each output type:
   * - 'text': Logged/displayed
   * - 'tool_call': Executed via ToolExecutor, result injected back
   * - 'interaction': UIP event emitted, waits for response
   * - 'done': TaskCompleted event emitted
   * - 'failed': TaskFailed event emitted
   *
   * @param task - The task to execute
   * @param context - Dependencies and configuration
   */
  run(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput>
}
