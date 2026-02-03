import type { Subscription } from 'rxjs'
import type { EventStore } from '../domain/ports/eventStore.js'
import type { LLMClient } from '../domain/ports/llmClient.js'
import type { Plan, DomainEvent, StoredEvent, UserFeedbackPostedPayload } from '../domain/events.js'
import type { TaskService } from '../application/taskService.js'
import type { Agent, AgentContext } from './agent.js'

// ============================================================================
// Agent Runtime
// ============================================================================

/**
 * AgentRuntime manages the execution of agents.
 *
 * It subscribes to the EventStore's events$ Observable and dispatches
 * events to the appropriate agent based on the task's agentId.
 *
 * V0: Only supports a single default agent.
 * V1: Will support an agent registry for multiple agents.
 */
export class AgentRuntime {
  readonly #store: EventStore
  readonly #taskService: TaskService
  readonly #agent: Agent
  readonly #llm: LLMClient
  readonly #baseDir: string

  #isRunning = false
  #subscription: Subscription | null = null
  #inFlight = new Set<string>() // Track in-flight task operations

  constructor(opts: {
    store: EventStore
    taskService: TaskService
    agent: Agent
    llm: LLMClient
    baseDir: string
  }) {
    this.#store = opts.store
    this.#taskService = opts.taskService
    this.#agent = opts.agent
    this.#llm = opts.llm
    this.#baseDir = opts.baseDir
  }

  /** The agent ID this runtime is responsible for */
  get agentId(): string {
    return this.#agent.id
  }

  start(): void {
    if (this.#isRunning) return
    this.#isRunning = true

    // Subscribe to event stream
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
  }

  get isRunning(): boolean {
    return this.#isRunning
  }

  async #handleEvent(event: StoredEvent): Promise<void> {
    if (!this.#isRunning) return

    // Handle TaskCreated events assigned to this agent
    if (event.type === 'TaskCreated' && event.payload.agentId === this.#agent.id) {
      const taskId = event.payload.taskId
      if (this.#inFlight.has(taskId)) return
      this.#inFlight.add(taskId)

      try {
        await this.handleTask(taskId)
      } catch (error) {
        console.error(`[AgentRuntime] Task handling failed for task ${taskId}:`, error)
      } finally {
        this.#inFlight.delete(taskId)
      }
    }

    // Handle UserFeedbackPosted events for tasks assigned to this agent
    if (event.type === 'UserFeedbackPosted') {
      const task = this.#taskService.getTask(event.payload.taskId)
      if (task && task.agentId === this.#agent.id) {
        const taskId = task.taskId
        const resumeKey = `resume:${taskId}:${event.id}`
        if (this.#inFlight.has(resumeKey)) return
        this.#inFlight.add(resumeKey)

        try {
          await this.resumeTask(task.taskId, event.payload)
        } catch (error) {
          console.error(`[AgentRuntime] Resume failed for task ${task.taskId}:`, error)
        } finally {
          this.#inFlight.delete(resumeKey)
        }
      }
    }
  }

  /**
   * Execute an agent workflow for a task.
   *
   * This is the main entry point for task execution.
   * It can be called directly (for manual execution) or via subscription.
   */
  async handleTask(taskId: string): Promise<{ taskId: string; events: DomainEvent[] }> {
    const task = this.#taskService.getTask(taskId)
    if (!task) {
      throw new Error(`未找到任务：${taskId}`)
    }

    // Verify this task is assigned to our agent
    if (task.agentId !== this.#agent.id) {
      throw new Error(`任务 ${taskId} 分配给 ${task.agentId}，而非 ${this.#agent.id}`)
    }

    const context: AgentContext = {
      llm: this.#llm,
      baseDir: this.#baseDir
    }

    // Emit TaskStarted event - agent claims the task
    const startedEvent: DomainEvent = {
      type: 'TaskStarted',
      payload: {
        taskId,
        agentId: this.#agent.id,
        authorActorId: this.#agent.id
      }
    }
    this.#store.append(taskId, [startedEvent])

    // Run the agent and collect emitted events
    const emittedEvents: DomainEvent[] = [startedEvent]
    try {
      for await (const event of this.#agent.run(task, context)) {
        this.#store.append(taskId, [event])
        emittedEvents.push(event)
      }
    } catch (error) {
      const failureEvent: DomainEvent = {
        type: 'TaskFailed',
        payload: {
          taskId,
          reason: this.#formatError(error),
          authorActorId: this.#agent.id
        }
      }
      this.#store.append(taskId, [failureEvent])
      emittedEvents.push(failureEvent)
      throw error
    }

    return { taskId, events: emittedEvents }
  }

  /**
   * Resume an agent workflow after user feedback.
   *
   * This is called when a UserFeedbackPosted event is received.
   * If the agent does not implement resume(), logs a warning and skips.
   */
  async resumeTask(taskId: string, feedback: UserFeedbackPostedPayload): Promise<{ taskId: string; events: DomainEvent[] }> {
    const task = this.#taskService.getTask(taskId)
    if (!task) {
      throw new Error(`未找到任务：${taskId}`)
    }

    // Verify this task is assigned to our agent
    if (task.agentId !== this.#agent.id) {
      throw new Error(`任务 ${taskId} 分配给 ${task.agentId}，而非 ${this.#agent.id}`)
    }

    // Check if agent implements resume
    if (!this.#agent.resume) {
      console.warn(`[AgentRuntime] Agent ${this.#agent.id} does not implement resume(), skipping feedback for task ${taskId}`)
      return { taskId, events: [] }
    }

    const context: AgentContext = {
      llm: this.#llm,
      baseDir: this.#baseDir
    }

    // Run the agent resume and collect emitted events
    const emittedEvents: DomainEvent[] = []
    try {
      for await (const event of this.#agent.resume(task, feedback, context)) {
        this.#store.append(taskId, [event])
        emittedEvents.push(event)
      }
    } catch (error) {
      const failureEvent: DomainEvent = {
        type: 'TaskFailed',
        payload: {
          taskId,
          reason: this.#formatError(error),
          authorActorId: this.#agent.id
        }
      }
      this.#store.append(taskId, [failureEvent])
      emittedEvents.push(failureEvent)
      throw error
    }

    return { taskId, events: emittedEvents }
  }

  #formatError(error: unknown): string {
    if (error instanceof Error) return error.message || String(error)
    return String(error)
  }

  /**
   * Get the last plan from a task execution.
   * Convenience method for testing and CLI.
   */
  getLastPlan(events: DomainEvent[]): { planId: string; plan: Plan } | null {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e?.type === 'AgentPlanPosted') {
        return { planId: e.payload.planId, plan: e.payload.plan }
      }
    }
    return null
  }
}
