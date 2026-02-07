import type { Subscription } from 'rxjs'
import type { EventStore } from '../domain/ports/eventStore.js'
import type { LLMClient } from '../domain/ports/llmClient.js'
import type { ToolRegistry } from '../domain/ports/tool.js'
import type { DomainEvent, StoredEvent } from '../domain/events.js'
import type { TaskService } from '../application/taskService.js'
import type { Agent } from './agent.js'
import type { ConversationManager } from './conversationManager.js'
import type { OutputHandler } from './outputHandler.js'
import { AgentRuntime } from './runtime.js'

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
 * Responsibilities:
 * - Agent registration (agent catalogue)
 * - Event subscription + routing by taskId
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

  #defaultAgentId: string | null = null
  #isRunning = false
  #subscription: Subscription | null = null

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

  get agents(): ReadonlyMap<string, Agent> {
    return this.#agents
  }

  // ======================== lifecycle ========================

  start(): void {
    if (this.#isRunning) return
    this.#isRunning = true

    this.#subscription = this.#store.events$.subscribe({
      next: (event) => {
        void this.#handleEvent(event)
      }
    })
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
  }

  get isRunning(): boolean {
    return this.#isRunning
  }

  // ======================== public task API ========================

  /**
   * Manually trigger execution for a specific task.
   * Used by CLI `agent run <taskId>` and `agent test`.
   */
  async executeTask(taskId: string): Promise<{ taskId: string; events: DomainEvent[] }> {
    const task = this.#taskService.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }
    const rt = this.#getOrCreateRuntime(taskId, task.agentId)
    return rt.execute()
  }

  // ======================== event routing ========================

  async #handleEvent(event: StoredEvent): Promise<void> {
    if (!this.#isRunning) return

    // --- TaskCreated ---
    if (event.type === 'TaskCreated') {
      const { taskId, agentId } = event.payload
      if (!this.#agents.has(agentId)) return // not our agent

      const rt = this.#getOrCreateRuntime(taskId, agentId)
      if (rt.isExecuting) return

      try {
        await this.#executeAndDrain(rt, taskId)
      } catch (error) {
        console.error(`[RuntimeManager] Task handling failed for task ${taskId}:`, error)
      } finally {
        this.#cleanupIfTerminal(taskId)
      }
    }

    // --- UserInteractionResponded ---
    if (event.type === 'UserInteractionResponded') {
      const task = this.#taskService.getTask(event.payload.taskId)
      if (!task) return
      if (!this.#agents.has(task.agentId)) return

      const taskId = task.taskId
      const rt = this.#getOrCreateRuntime(taskId, task.agentId)

      try {
        await rt.resume(event.payload)
        // After resume, drain any queued instructions
        await this.#drainPending(rt, taskId)
      } catch (error) {
        console.error(`[RuntimeManager] Resume failed for task ${taskId}:`, error)
      } finally {
        this.#cleanupIfTerminal(taskId)
      }
    }

    // --- TaskPaused ---
    if (event.type === 'TaskPaused') {
      const rt = this.#runtimes.get(event.payload.taskId)
      if (rt) rt.onPause()
    }

    // --- TaskResumed ---
    if (event.type === 'TaskResumed') {
      const task = this.#taskService.getTask(event.payload.taskId)
      if (!task) return
      if (!this.#agents.has(task.agentId)) return

      const taskId = task.taskId
      const rt = this.#getOrCreateRuntime(taskId, task.agentId)

      try {
        await rt.onResume()
      } catch (error) {
        console.error(`[RuntimeManager] Resume failed for task ${taskId}:`, error)
      } finally {
        this.#cleanupIfTerminal(taskId)
      }
    }

    // --- TaskInstructionAdded ---
    if (event.type === 'TaskInstructionAdded') {
      const task = this.#taskService.getTask(event.payload.taskId)
      if (!task) return
      if (!this.#agents.has(task.agentId)) return

      const taskId = task.taskId
      const rt = this.#getOrCreateRuntime(taskId, task.agentId)

      try {
        await rt.onInstruction(event.payload.instruction)
      } catch (error) {
        console.error(`[RuntimeManager] Instruction handling failed for task ${taskId}:`, error)
      } finally {
        this.#cleanupIfTerminal(taskId)
      }
    }

    // --- TaskCanceled (NEW — fixes missing handler bug) ---
    if (event.type === 'TaskCanceled') {
      const rt = this.#runtimes.get(event.payload.taskId)
      if (rt) {
        rt.onCancel()
        this.#runtimes.delete(event.payload.taskId)
      }
    }

    // --- Terminal events: TaskCompleted, TaskFailed ---
    if (event.type === 'TaskCompleted' || event.type === 'TaskFailed') {
      this.#runtimes.delete(event.payload.taskId)
    }
  }

  // ======================== helpers ========================

  /**
   * Execute a runtime and drain any instructions queued during execution.
   * This ensures queued instructions trigger re-execution.
   */
  async #executeAndDrain(rt: AgentRuntime, taskId: string): Promise<void> {
    await rt.execute()
    await this.#drainPending(rt, taskId)
  }

  /**
   * If the runtime has pending work (queued instructions), re-execute until drained.
   */
  async #drainPending(rt: AgentRuntime, taskId: string): Promise<void> {
    while (rt.hasPendingWork && this.#isRunning) {
      const task = this.#taskService.getTask(taskId)
      if (!task) return
      if (task.status === 'awaiting_user' || task.status === 'paused' || task.status === 'canceled') return
      await rt.execute()
    }
  }

  #getOrCreateRuntime(taskId: string, agentId: string): AgentRuntime {
    let rt = this.#runtimes.get(taskId)
    if (rt) return rt

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

    this.#runtimes.set(taskId, rt)
    return rt
  }

  #cleanupIfTerminal(taskId: string): void {
    const task = this.#taskService.getTask(taskId)
    if (!task) {
      this.#runtimes.delete(taskId)
      return
    }
    if (task.status === 'done' || task.status === 'failed' || task.status === 'canceled') {
      this.#runtimes.delete(taskId)
    }
  }
}
