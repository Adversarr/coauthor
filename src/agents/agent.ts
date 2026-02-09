import type { UserInteractionRespondedPayload } from '../domain/events.js'
import type { TaskView } from '../application/taskService.js'
import type { LLMClient, LLMMessage, LLMProfile } from '../domain/ports/llmClient.js'
import type { ToolRegistry, ToolCallRequest, ToolGroup } from '../domain/ports/tool.js'
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
 *
 * When an agent yields `tool_call`, control transfers to the Runtime which:
 * 1. Executes the tool via ToolExecutor
 * 2. Persists the tool-result message into conversationHistory
 * 3. Returns control to the agent generator
 *
 * The agent does NOT need to read tool results explicitly — they appear
 * in `conversationHistory` as `role: 'tool'` messages for the next LLM call.
 */
export type AgentOutput =
  | { kind: 'text'; content: string }
  | { kind: 'verbose'; content: string }
  | { kind: 'error'; content: string }
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
 *
 * Tool results are NOT exposed to agents via a Map. Instead, when an agent
 * yields `{ kind: 'tool_call' }`, the Runtime executes the tool and persists
 * the result into `conversationHistory`. The agent sees tool results as
 * `role: 'tool'` messages on the next LLM call — single source of truth.
 */
export type AgentContext = {
  /** LLM client for generating responses */
  readonly llm: LLMClient
  
  /** Tool registry for accessing available tools (pre-filtered per agent) */
  readonly tools: ToolRegistry
  
  /** Base directory of the workspace */
  readonly baseDir: string
  
  /**
   * Conversation history for multi-turn interactions.
   * Pre-loaded from ConversationStore by Runtime on start/resume.
   * Use `persistMessage()` to add new messages.
   */
  readonly conversationHistory: readonly LLMMessage[]
  
  /** Response to a pending interaction (if resuming from a generic UIP) */
  readonly pendingInteractionResponse?: UserInteractionRespondedPayload

  /** Override the agent's default LLM profile for this execution. */
  readonly profileOverride?: LLMProfile

  /**
   * Optional callback for streaming LLM chunks to the UI.
   * When provided, the agent should call `llm.stream()` with this callback
   * instead of `llm.complete()`, enabling real-time text display.
   * Only text and reasoning chunks are forwarded to the UI; tool call
   * chunks are accumulated internally.
   */
  readonly onStreamChunk?: (chunk: import('../domain/ports/llmClient.js').LLMStreamChunk) => void

  /**
   * Persist a message to conversation history.
   * Call this after each LLM response or tool result to ensure
   * the message survives pauses, restarts, and crashes.
   */
  persistMessage(message: LLMMessage): Promise<void>
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

  /** Human-readable description of agent capabilities */
  readonly description: string

  /** Tool groups this agent can access. Empty = no tools. */
  readonly toolGroups: readonly ToolGroup[]

  /** Default LLM profile this agent uses */
  readonly defaultProfile: LLMProfile

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
