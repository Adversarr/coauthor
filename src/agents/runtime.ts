import type { EventStore } from '../domain/ports/eventStore.js'
import type { LLMClient, LLMMessage } from '../domain/ports/llmClient.js'
import type { ToolRegistry, ToolCallRequest } from '../domain/ports/tool.js'
import type { DomainEvent, UserInteractionRespondedPayload } from '../domain/events.js'
import type { TaskService, TaskView } from '../application/taskService.js'
import type { Agent, AgentContext } from './agent.js'
import type { ConversationManager } from './conversationManager.js'
import type { OutputHandler, OutputContext } from './outputHandler.js'

// ============================================================================
// Agent Runtime — Task-Scoped Executor
// ============================================================================

/**
 * AgentRuntime manages the execution of exactly ONE task by ONE agent.
 *
 * Each runtime instance is created for a specific task and discarded
 * when the task reaches a terminal state. This eliminates all multi-task
 * state (Maps, Sets) and the bugs they caused (key collisions, stale
 * entries, memory leaks).
 *
 * **Concurrency model**: The runtime is designed as a non-reentrant actor.
 * All entry points (`execute`, `resume`, `onResume`, `onInstruction`) are
 * expected to be serialized by RuntimeManager's per-task lock. The internal
 * `#isExecuting` flag is a safety net for detecting unexpected re-entrancy,
 * not the primary concurrency guard.
 *
 * Responsibilities:
 * - Agent loop orchestration (delegates output handling to OutputHandler)
 * - Pause / cancel signalling (cooperative, checked at safe yield points)
 * - Instruction queueing during unsafe conversation states
 *
 * Event routing and runtime lifecycle → RuntimeManager
 * Conversation management → ConversationManager
 * Output processing / tool execution → OutputHandler
 */
export class AgentRuntime {
  readonly #taskId: string
  readonly #store: EventStore
  readonly #taskService: TaskService
  readonly #agent: Agent
  readonly #llm: LLMClient
  readonly #toolRegistry: ToolRegistry
  readonly #baseDir: string
  readonly #conversationManager: ConversationManager
  readonly #outputHandler: OutputHandler

  /**
   * True while the agent loop is in progress. Used as a safety net
   * to detect unexpected re-entrancy; primary serialization is
   * via RuntimeManager's per-task lock.
   */
  #isExecuting = false
  #isPaused = false
  #isCanceled = false
  #pendingInstructions: string[] = []
  /**
   * Controller for aborting blocked tool calls on cancel AND pause.
   * Both pause and cancel now abort via this controller so that
   * long-running tools (e.g. create_subtask) unblock promptly (RD-002).
   */
  #abortController: AbortController | null = null

  constructor(opts: {
    taskId: string
    store: EventStore
    taskService: TaskService
    agent: Agent
    llm: LLMClient
    toolRegistry: ToolRegistry
    baseDir: string
    conversationManager: ConversationManager
    outputHandler: OutputHandler
  }) {
    this.#taskId = opts.taskId
    this.#store = opts.store
    this.#taskService = opts.taskService
    this.#agent = opts.agent
    this.#llm = opts.llm
    this.#toolRegistry = opts.toolRegistry
    this.#baseDir = opts.baseDir
    this.#conversationManager = opts.conversationManager
    this.#outputHandler = opts.outputHandler
  }

  // ======================== getters ========================

  get taskId(): string {
    return this.#taskId
  }

  get agentId(): string {
    return this.#agent.id
  }

  get isExecuting(): boolean {
    return this.#isExecuting
  }

  get hasPendingWork(): boolean {
    return this.#pendingInstructions.length > 0
  }

  // ======================== imperative control (called by RuntimeManager) ========================

  /**
   * Signal that the task should pause at the next safe point.
   *
   * Also aborts in-flight blocking tool calls (e.g. create_subtask waits)
   * so that pause takes effect promptly even when tools are blocked (RD-002).
   * The AbortError is caught by the agent loop / tool and treated as a
   * cooperative exit rather than a fatal error.
   */
  onPause(): void {
    this.#isPaused = true
    this.#abortController?.abort()
  }

  /**
   * Clear the pause signal and trigger re-execution if idle.
   * Called by RuntimeManager under the per-task lock.
   */
  async onResume(): Promise<void> {
    this.#isPaused = false

    if (this.#isExecuting) return

    await this.#executeAndDrainQueuedInstructions()
  }

  /**
   * Signal cancellation. The agent loop will break at the next safe point.
   * Also aborts any in-flight blocking tool calls immediately.
   */
  onCancel(): void {
    this.#isCanceled = true
    this.#abortController?.abort()
  }

  /**
   * Handle a new instruction for this task.
   *
   * During execution: always queued in #pendingInstructions (drained at safe
   * points by the agent loop). This fixes the old bug where "safe" injection
   * wrote to the durable store but not the in-memory conversationHistory.
   *
   * When idle AND conversation is safe: written to conversation store and
   * triggers re-execution.
   *
   * When idle BUT conversation is unsafe (dangling tool calls): queued in
   * #pendingInstructions until the next execution drains them at a safe point.
   */
  async onInstruction(instruction: string): Promise<void> {
    this.#isPaused = false

    if (this.#isExecuting) {
      // Always queue during execution — the running loop drains at safe points
      this.#pendingInstructions.push(instruction)
      return
    }

    // Check conversation safety: if there are dangling tool calls, we must
    // queue the instruction so it gets injected AFTER the tool results.
    const history = await this.#conversationManager.store.getMessages(this.#taskId)
    if (!this.#conversationManager.isSafeToInject(history)) {
      this.#pendingInstructions.push(instruction)
      // Don't re-execute now — a UIP response or resume will drain the queue
      return
    }

    // Safe to inject directly and re-execute
    await this.#conversationManager.store.append(this.#taskId, {
      role: 'user',
      content: instruction
    } as LLMMessage)

    await this.#executeAndDrainQueuedInstructions()
  }

  // ======================== task execution ========================

  /**
   * Execute the agent workflow for this task.
   *
   * Main entry point — emits TaskStarted, runs the agent loop.
   * Called by RuntimeManager (under per-task lock) or by the drain loop.
   */
  async execute(): Promise<{ taskId: string; events: DomainEvent[] }> {
    const task = await this.#taskService.getTask(this.#taskId)
    if (!task) {
      throw new Error(`Task not found: ${this.#taskId}`)
    }
    if (task.agentId !== this.#agent.id) {
      throw new Error(`Task ${this.#taskId} assigned to ${task.agentId}, not ${this.#agent.id}`)
    }

    if (!this.#taskService.canTransition(task.status, 'TaskStarted')) {
      throw new Error(`Invalid transition: cannot start task in state ${task.status}`)
    }

    const startedEvent: DomainEvent = {
      type: 'TaskStarted',
      payload: { taskId: this.#taskId, agentId: this.#agent.id, authorActorId: this.#agent.id }
    }
    await this.#store.append(this.#taskId, [startedEvent])

    const emittedEvents: DomainEvent[] = [startedEvent]

    this.#isExecuting = true
    try {
      return await this.#runAgentLoop(task, emittedEvents)
    } finally {
      this.#isExecuting = false
    }
  }

  /**
   * Resume the agent workflow after a user interaction response.
   * Called by RuntimeManager under the per-task lock.
   */
  async resume(
    response: UserInteractionRespondedPayload
  ): Promise<{ taskId: string; events: DomainEvent[] }> {
    const task = await this.#taskService.getTask(this.#taskId)
    if (!task) {
      throw new Error(`Task not found: ${this.#taskId}`)
    }
    if (task.agentId !== this.#agent.id) {
      throw new Error(`Task ${this.#taskId} assigned to ${task.agentId}, not ${this.#agent.id}`)
    }

    this.#isExecuting = true
    try {
      return await this.#runAgentLoop(task, [], response)
    } finally {
      this.#isExecuting = false
    }
  }

  // ======================== internal: drain loop ========================

  /**
   * Execute then drain queued instructions.
   *
   * The outer `#isExecuting` flag spans the entire drain cycle
   * to prevent false-idle windows where another entry point could
   * observe `#isExecuting === false` mid-drain (CC-008).
   *
   * Individual `execute()` calls within the loop set the flag
   * redundantly (safe, since it's already true), and their
   * `finally` blocks reset it — but we restore it immediately
   * since the drain loop is still active.
   */
  async #executeAndDrainQueuedInstructions(): Promise<void> {
    if (this.#isExecuting) return

    this.#isExecuting = true
    try {
      await this.#runExecute()

      while (this.#pendingInstructions.length > 0) {
        const task = await this.#taskService.getTask(this.#taskId)
        if (!task) return
        if (task.status === 'awaiting_user' || task.status === 'paused') return
        if (this.#isPaused || this.#isCanceled) return

        // Re-execute to drain pending instructions
        this.#isExecuting = true  // restore in case inner execute's finally cleared it
        await this.#runExecute()
      }
    } finally {
      this.#isExecuting = false
    }
  }

  /**
   * Inner execute helper that catches transition errors gracefully.
   * If the task was concurrently moved to a non-startable state,
   * we log and return rather than throwing (CC-003).
   */
  async #runExecute(): Promise<void> {
    try {
      await this.execute()
    } catch (error) {
      // Gracefully handle invalid transitions caused by concurrent
      // pause/cancel rather than crashing the drain loop (CC-003)
      if (error instanceof Error && error.message.startsWith('Invalid transition:')) {
        return
      }
      throw error
    }
  }

  // ======================== agent loop ========================

  /**
   * Core agent execution loop.
   *
   * Loads conversation, builds AgentContext, runs the agent generator,
   * and delegates each yielded output to the OutputHandler.
   */
  async #runAgentLoop(
    task: TaskView,
    emittedEvents: DomainEvent[],
    pendingResponse?: UserInteractionRespondedPayload
  ): Promise<{ taskId: string; events: DomainEvent[] }> {
    const taskId = this.#taskId

    // Load & repair conversation history
    const conversationHistory = await this.#conversationManager.loadAndRepair(
      taskId,
      this.#agent.id,
      this.#baseDir
    )

    const isApproved = pendingResponse?.selectedOptionId === 'approve'
    const interactionId = pendingResponse?.interactionId

    const interactionToolCallId = interactionId
      ? await this.#resolveToolCallIdForInteraction(interactionId)
      : undefined

    const confirmedInteractionId = isApproved ? interactionId : undefined
    const confirmedToolCallId = isApproved ? interactionToolCallId : undefined

    const persistMessage = this.#conversationManager.createPersistCallback(taskId, conversationHistory)

    // Create a fresh AbortController for this loop invocation.
    // Aborted on cancel so blocking tools (e.g. create_subtask) unblock.
    this.#abortController = new AbortController()

    const outputCtx: OutputContext = {
      taskId,
      agentId: this.#agent.id,
      baseDir: this.#baseDir,
      confirmedInteractionId,
      confirmedToolCallId,
      conversationHistory,
      persistMessage,
      signal: this.#abortController.signal
    }

    // If user rejected a risky tool, record rejection via OutputHandler
    // (emits audit entries for live TUI display + persists to conversation)
    if (pendingResponse && !isApproved) {
      await this.#outputHandler.handleRejections(outputCtx, interactionToolCallId)
    }

    const context: AgentContext = {
      llm: this.#llm,
      tools: this.#toolRegistry,
      baseDir: this.#baseDir,
      conversationHistory,
      pendingInteractionResponse: pendingResponse,
      persistMessage
    }

    try {
      // Drain any instructions queued before this loop started
      await this.#conversationManager.drainPendingInstructions(
        this.#pendingInstructions, conversationHistory, persistMessage
      )

      // Process pending tool calls from previous turn (e.g. multi-tool batch)
      const pendingCalls = this.#conversationManager.getPendingToolCalls(conversationHistory)
      for (const call of pendingCalls) {
        // Check for cancel signal
        if (this.#isCanceled) break

        // Check for pause signal — only at safe conversation state
        if (this.#isPaused && this.#conversationManager.isSafeToInject(conversationHistory)) {
          break
        }

        const result = await this.#outputHandler.handle(
          { kind: 'tool_call', call },
          outputCtx
        )

        if (result.event) {
          const currentTask = await this.#taskService.getTask(taskId)
          if (!currentTask) throw new Error(`Task not found: ${taskId}`)

          if (!this.#taskService.canTransition(currentTask.status, result.event.type)) {
            console.warn(
              `[AgentRuntime] Skipping ${result.event.type}: task ${taskId} ` +
              `is in state ${currentTask.status}, breaking loop gracefully`
            )
            break
          }

          await this.#store.append(taskId, [result.event])
          emittedEvents.push(result.event)
        }

        if (result.pause) return { taskId, events: emittedEvents }
        if (result.terminal) return { taskId, events: emittedEvents }
      }

      for await (const output of this.#agent.run(task, context)) {
        // Drain pending instructions between yields (if safe)
        await this.#conversationManager.drainPendingInstructions(
          this.#pendingInstructions, conversationHistory, persistMessage
        )

        // Check for cancel signal
        if (this.#isCanceled) break

        // Check for pause signal — only at safe conversation state
        if (this.#isPaused && this.#conversationManager.isSafeToInject(conversationHistory)) {
          break
        }

        const result = await this.#outputHandler.handle(output, outputCtx)

        if (result.event) {
          const currentTask = await this.#taskService.getTask(taskId)
          if (!currentTask) throw new Error(`Task not found: ${taskId}`)

          if (!this.#taskService.canTransition(currentTask.status, result.event.type)) {
            // Graceful exit: task was concurrently paused/canceled.
            // Instead of throwing, we break the loop — the event will
            // not be persisted, and the pause/cancel takes precedence (CC-003).
            console.warn(
              `[AgentRuntime] Skipping ${result.event.type}: task ${taskId} ` +
              `is in state ${currentTask.status}, breaking loop gracefully`
            )
            break
          }

          await this.#store.append(taskId, [result.event])
          emittedEvents.push(result.event)
        }

        if (result.pause) break
        if (result.terminal) break
      }
    } catch (error) {
      const currentTask = await this.#taskService.getTask(taskId)
      
      if (currentTask && this.#taskService.canTransition(currentTask.status, 'TaskFailed')) {
        const failureEvent: DomainEvent = {
          type: 'TaskFailed',
          payload: {
            taskId,
            reason: error instanceof Error ? error.message || String(error) : String(error),
            authorActorId: this.#agent.id
          }
        }
        await this.#store.append(taskId, [failureEvent])
        emittedEvents.push(failureEvent)
      }
      throw error
    }

    return { taskId, events: emittedEvents }
  }

  async #resolveToolCallIdForInteraction(interactionId: string): Promise<string | undefined> {
    const events = await this.#store.readStream(this.#taskId)
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event.type !== 'UserInteractionRequested') continue
      if (event.payload.interactionId !== interactionId) continue
      return (event.payload.display?.metadata as Record<string, string> | undefined)?.toolCallId
    }
    return undefined
  }

}
