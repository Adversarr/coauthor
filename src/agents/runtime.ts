import type { EventStore } from '../domain/ports/eventStore.js'
import type { LLMClient, LLMMessage } from '../domain/ports/llmClient.js'
import type { ToolRegistry } from '../domain/ports/tool.js'
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

  // All state is scalar — no Maps or Sets needed for a single task.
  #isExecuting = false
  #isPaused = false
  #isCanceled = false
  #pendingInstructions: string[] = []

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
   * Cooperative: the agent loop checks this flag between yields.
   */
  onPause(): void {
    this.#isPaused = true
  }

  /**
   * Clear the pause signal and trigger re-execution.
   */
  async onResume(): Promise<void> {
    this.#isPaused = false

    if (this.#isExecuting) return

    await this.#executeAndDrainQueuedInstructions()
  }

  /**
   * Signal cancellation. The agent loop will break at the next safe point.
   */
  onCancel(): void {
    this.#isCanceled = true
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
   * Can be called directly (manual execution) or by RuntimeManager.
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
    // Clear the sentinel — actual instructions are tracked in #pendingInstructions.
    // New instructions arriving during this execute() will re-set the flag.
    this.#isExecuting = true
    try {
      return await this.#runAgentLoop(task, emittedEvents)
    } finally {
      this.#isExecuting = false
    }
  }

  /**
   * Resume the agent workflow after a user interaction response.
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

  async #executeAndDrainQueuedInstructions(): Promise<void> {
    if (this.#isExecuting) return

    this.#isExecuting = true
    try {
      while (true) {
        await this.execute()

        const task = await this.#taskService.getTask(this.#taskId)
        if (!task) return
        if (task.status === 'awaiting_user' || task.status === 'paused') return

        if (this.#pendingInstructions.length === 0) return

        if (this.#isPaused) return
        if (this.#isCanceled) return
      }
    } finally {
      this.#isExecuting = false
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

    const confirmedInteractionId = pendingResponse?.selectedOptionId === 'approve'
      ? pendingResponse.interactionId
      : undefined

    const persistMessage = this.#conversationManager.createPersistCallback(taskId, conversationHistory)

    const outputCtx: OutputContext = {
      taskId,
      agentId: this.#agent.id,
      baseDir: this.#baseDir,
      confirmedInteractionId,
      conversationHistory,
      persistMessage
    }

    // If user rejected a risky tool, record rejection via OutputHandler
    // (emits audit entries for live TUI display + persists to conversation)
    if (pendingResponse && pendingResponse.selectedOptionId !== 'approve') {
      await this.#outputHandler.handleRejections(outputCtx)
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
             throw new Error(`Invalid transition: cannot emit ${result.event.type} in state ${currentTask.status}`)
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

}
