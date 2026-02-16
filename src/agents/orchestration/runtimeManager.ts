import type { Subscription } from '../../core/ports/subscribable.js'
import type { EventStore } from '../../core/ports/eventStore.js'
import type { LLMClient, LLMProfile } from '../../core/ports/llmClient.js'
import type { ToolRegistry } from '../../core/ports/tool.js'
import type { DomainEvent, StoredEvent } from '../../core/events/events.js'
import type { TaskService } from '../../application/services/taskService.js'
import type { Agent } from '../core/agent.js'
import type { ConversationManager } from './conversationManager.js'
import type { OutputHandler } from './outputHandler.js'
import { AgentRuntime } from '../core/runtime.js'
import { AsyncMutex } from '../../infrastructure/asyncMutex.js'

// ============================================================================
// Runtime Manager — Multi-Agent Orchestrator
// ============================================================================

/**
 * RuntimeManager is the single subscriber to `EventStore.events$`.
 *
 * It owns a Map<taskId, AgentRuntime> and routes events to the correct
 * task-scoped runtime. It creates runtimes on TaskCreated/TaskResumed
 * and destroys them when tasks reach terminal states.
 *
 * **Concurrency model**: Every event handler and manual execution call is
 * serialized per-task via an `AsyncMutex`. This ensures that for a given
 * taskId, only one handler runs at a time, eliminating race conditions
 * between overlapping event handlers (CC-001, CC-002, CC-006, CC-007).
 *
 * Responsibilities:
 * - Agent registration (agent catalogue)
 * - Event subscription + per-task serialized routing
 * - AgentRuntime creation / destruction
 * - Public API surface consumed by CLI and TUI
 */
export class RuntimeManager {
  readonly #store: EventStore
  readonly #taskService: TaskService
  readonly #llm: LLMClient
  readonly #toolRegistry: ToolRegistry
  readonly #baseDir: string
  readonly #conversationManager: ConversationManager
  readonly #outputHandler: OutputHandler

  /** agentId → Agent implementation */
  readonly #agents = new Map<string, Agent>()
  /** taskId → task-scoped AgentRuntime */
  readonly #runtimes = new Map<string, AgentRuntime>()
  /**
   * Per-task mutex ensuring only one handler/execution runs at a time
   * for each taskId. Eliminates overlapping handler races (CC-001).
   */
  readonly #taskLocks = new Map<string, AsyncMutex>()

  #defaultAgentId: string | null = null
  #isRunning = false
  #subscription: Subscription | null = null
  /** Tracked in-flight event handler promises (for waitForIdle) */
  readonly #pendingHandlers = new Set<Promise<void>>()
  /** Per-task LLM profile overrides (set by TUI /model command) */
  readonly #profileOverrides = new Map<string, LLMProfile>()
  /** Whether streaming mode is enabled globally */
  #streamingEnabled = false

  constructor(opts: {
    store: EventStore
    taskService: TaskService
    llm: LLMClient
    toolRegistry: ToolRegistry
    baseDir: string
    conversationManager: ConversationManager
    outputHandler: OutputHandler
  }) {
    this.#store = opts.store
    this.#taskService = opts.taskService
    this.#llm = opts.llm
    this.#toolRegistry = opts.toolRegistry
    this.#baseDir = opts.baseDir
    this.#conversationManager = opts.conversationManager
    this.#outputHandler = opts.outputHandler
  }

  // ======================== agent registration ========================

  /**
   * Register an agent implementation.
   * The first registered agent becomes the default.
   */
  registerAgent(agent: Agent): void {
    this.#agents.set(agent.id, agent)
    if (this.#defaultAgentId === null) {
      this.#defaultAgentId = agent.id
    }
  }

  get defaultAgentId(): string {
    if (!this.#defaultAgentId) {
      throw new Error('No agents registered')
    }
    return this.#defaultAgentId
  }

  set defaultAgentId(id: string) {
    if (!this.#agents.has(id)) {
      throw new Error(`Agent not registered: ${id}`)
    }
    this.#defaultAgentId = id
  }

  get agents(): ReadonlyMap<string, Agent> {
    return this.#agents
  }

  get toolRegistry(): ToolRegistry {
    return this.#toolRegistry
  }

  // ======================== profile overrides ========================

  /** Set an LLM profile override for a task (or globally with taskId='*'). */
  setProfileOverride(taskId: string, profile: LLMProfile): void {
    this.#profileOverrides.set(taskId, profile)
  }

  /** Get the effective profile override for a task (task-specific first, then global). */
  getProfileOverride(taskId: string): LLMProfile | undefined {
    return this.#profileOverrides.get(taskId) ?? this.#profileOverrides.get('*')
  }

  /** Clear a profile override. */
  clearProfileOverride(taskId: string): void {
    this.#profileOverrides.delete(taskId)
  }

  // ======================== streaming ========================

  get streamingEnabled(): boolean {
    return this.#streamingEnabled
  }

  set streamingEnabled(enabled: boolean) {
    this.#streamingEnabled = enabled
  }

  // ======================== lifecycle ========================

  start(): void {
    if (this.#isRunning) return
    this.#isRunning = true

    this.#subscription = this.#store.events$.subscribe((event) => {
      const p = this.#handleEvent(event).finally(() => {
        this.#pendingHandlers.delete(p)
      })
      this.#pendingHandlers.add(p)
    })
  }

  /**
   * Wait until all in-flight event handlers have settled.
   * Useful in tests to await fire-and-forget processing.
   */
  async waitForIdle(): Promise<void> {
    while (this.#pendingHandlers.size > 0) {
      await Promise.all([...this.#pendingHandlers])
    }
  }

  stop(): void {
    this.#isRunning = false
    if (this.#subscription) {
      this.#subscription.unsubscribe()
      this.#subscription = null
    }
    // Signal cancel to all in-flight runtimes
    for (const rt of this.#runtimes.values()) {
      rt.onCancel()
    }
    this.#runtimes.clear()
    this.#taskLocks.clear()
  }

  get isRunning(): boolean {
    return this.#isRunning
  }

  // ======================== public task API ========================

  /**
   * Manually trigger execution for a specific task.
   * Used by interactive surfaces (TUI/Web) and tests.
   *
   * Serialized via the per-task lock so it cannot overlap with
   * event-driven execution for the same task (CC-007).
   */
  async executeTask(taskId: string): Promise<{ taskId: string; events: DomainEvent[] }> {
    const lock = this.#getTaskLock(taskId)
    return lock.runExclusive(async () => {
      const task = await this.#taskService.getTask(taskId)
      if (!task) {
        throw new Error(`Task not found: ${taskId}`)
      }
      const rt = this.#getOrCreateRuntime(taskId, task.agentId)
      return this.#executeAndDrain(rt, taskId)
    })
  }

  // ======================== event routing ========================

  /**
   * Route a stored event to the appropriate handler.
   *
   * All handlers that invoke runtime methods are serialized per-task
   * via `#withTaskLock()`. This prevents overlapping execution of
   * `execute()`, `resume()`, `onInstruction()`, etc. for the same task,
   * which was the root cause of CC-001/CC-002/CC-006 bugs.
   *
   * Lightweight signals (`onPause`, `onCancel`) and cleanup are safe
   * to run outside the lock since they only set cooperative flags.
   */
  async #handleEvent(event: StoredEvent): Promise<void> {
    if (!this.#isRunning) return

    const taskId = this.#extractTaskId(event)
    if (!taskId) return

    // --- TaskPaused: lightweight cooperative signal, no lock needed ---
    if (event.type === 'TaskPaused') {
      const rt = this.#runtimes.get(taskId)
      if (rt) rt.onPause()
      return
    }

    // --- TaskCanceled: lightweight signal + cleanup ---
    if (event.type === 'TaskCanceled') {
      const rt = this.#runtimes.get(taskId)
      if (rt) {
        rt.onCancel()
        this.#runtimes.delete(taskId)
      }
      this.#cleanupTaskLock(taskId)
      return
    }

    // --- Terminal events: cleanup only ---
    if (event.type === 'TaskCompleted' || event.type === 'TaskFailed') {
      this.#runtimes.delete(taskId)
      this.#cleanupTaskLock(taskId)
      return
    }

    // --- All other events: serialized per-task ---
    await this.#withTaskLock(taskId, async () => {
      if (!this.#isRunning) return

      if (event.type === 'TaskCreated') {
        const { agentId } = event.payload
        if (!this.#agents.has(agentId)) return

        const rt = this.#getOrCreateRuntime(taskId, agentId)
        if (rt.isExecuting) return

        await this.#executeAndDrain(rt, taskId)
      }

      if (event.type === 'UserInteractionResponded') {
        const task = await this.#taskService.getTask(taskId)
        if (!task) return
        if (!this.#agents.has(task.agentId)) return

        // Validate response matches the currently pending interaction (SA-002)
        if (task.pendingInteractionId &&
            task.pendingInteractionId !== event.payload.interactionId) {
          console.warn(
            `[RuntimeManager] Ignoring stale UIP response ${event.payload.interactionId}` +
            ` for task ${taskId} (pending: ${task.pendingInteractionId})`
          )
          return
        }

        const rt = this.#getOrCreateRuntime(taskId, task.agentId)
        await rt.resume(event.payload)
        await this.#drainPending(rt, taskId)
      }

      if (event.type === 'TaskResumed') {
        const task = await this.#taskService.getTask(taskId)
        if (!task) return
        if (!this.#agents.has(task.agentId)) return

        const rt = this.#getOrCreateRuntime(taskId, task.agentId)
        await rt.onResume()
      }

      if (event.type === 'TaskInstructionAdded') {
        const task = await this.#taskService.getTask(taskId)
        if (!task) return
        if (!this.#agents.has(task.agentId)) return

        const rt = this.#getOrCreateRuntime(taskId, task.agentId)
        await rt.onInstruction(event.payload.instruction)
      }

      await this.#cleanupIfTerminal(taskId)
    })
  }

  // ======================== helpers ========================

  /**
   * Get or create a per-task mutex for serialized event handling.
   */
  #getTaskLock(taskId: string): AsyncMutex {
    let lock = this.#taskLocks.get(taskId)
    if (!lock) {
      lock = new AsyncMutex()
      this.#taskLocks.set(taskId, lock)
    }
    return lock
  }

  /**
   * Run `fn` while holding the per-task lock, with error logging.
   * This is the single serialization point for all task operations.
   */
  async #withTaskLock(taskId: string, fn: () => Promise<void>): Promise<void> {
    const lock = this.#getTaskLock(taskId)
    await lock.runExclusive(async () => {
      try {
        await fn()
      } catch (error) {
        console.error(`[RuntimeManager] Handler failed for task ${taskId}:`, error)
      }
    })
  }

  /**
   * Extract the taskId from any domain event's payload.
   */
  #extractTaskId(event: StoredEvent): string | undefined {
    return (event.payload as { taskId?: string }).taskId
  }

  /**
   * Execute a runtime and drain any instructions queued during execution.
   * Caller must hold the per-task lock.
   */
  async #executeAndDrain(rt: AgentRuntime, taskId: string): Promise<{ taskId: string; events: DomainEvent[] }> {
    const result = await rt.execute()
    await this.#drainPending(rt, taskId)
    return result
  }

  /**
   * If the runtime has pending work (queued instructions), re-execute until drained.
   * Caller must hold the per-task lock.
   */
  async #drainPending(rt: AgentRuntime, taskId: string): Promise<void> {
    while (rt.hasPendingWork && this.#isRunning) {
      const task = await this.#taskService.getTask(taskId)
      if (!task) return
      if (task.status === 'awaiting_user' || task.status === 'paused' || task.status === 'canceled') return
      await rt.execute()
    }
  }

  #getOrCreateRuntime(taskId: string, agentId: string): AgentRuntime {
    let rt = this.#runtimes.get(taskId)
    if (rt) {
      rt.profileOverride = this.getProfileOverride(taskId)
      rt.streamingEnabled = this.#streamingEnabled
      return rt
    }

    const agent = this.#agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent not registered: ${agentId}`)
    }

    rt = new AgentRuntime({
      taskId,
      store: this.#store,
      taskService: this.#taskService,
      agent,
      llm: this.#llm,
      toolRegistry: this.#toolRegistry,
      baseDir: this.#baseDir,
      conversationManager: this.#conversationManager,
      outputHandler: this.#outputHandler
    })
    rt.profileOverride = this.getProfileOverride(taskId)
    rt.streamingEnabled = this.#streamingEnabled

    this.#runtimes.set(taskId, rt)
    return rt
  }

  /**
   * Clean up runtime and lock for a task that has reached a terminal state.
   * Caller must hold the per-task lock (or the task must be terminal).
   */
  async #cleanupIfTerminal(taskId: string): Promise<void> {
    const task = await this.#taskService.getTask(taskId)
    if (!task) {
      this.#runtimes.delete(taskId)
      return
    }
    if (task.status === 'done' || task.status === 'failed' || task.status === 'canceled') {
      this.#runtimes.delete(taskId)
    }
  }

  /**
   * Remove the per-task lock. Called after terminal events where no
   * further handlers are expected for this task.
   */
  #cleanupTaskLock(taskId: string): void {
    this.#taskLocks.delete(taskId)
  }
}
