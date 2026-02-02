import { nanoid } from 'nanoid'
import type { EventStore } from '../domain/ports/eventStore.js'
import type { LLMClient } from '../domain/ports/llmClient.js'
import { PlanSchema, type Plan } from '../domain/events.js'
import type { TaskService, TaskView } from '../application/taskService.js'
import type { ContextBuilder } from '../application/contextBuilder.js'

function fallbackPlan(task: TaskView, raw: string): Plan {
  return {
    goal: `Plan for: ${task.title}`,
    strategy: 'Fallback plan due to invalid model output',
    scope: 'M1 preparation stage',
    issues: [`raw_output_length=${raw.length}`],
    risks: [],
    questions: []
  }
}

export class AgentRuntime {
  readonly #store: EventStore
  readonly #taskService: TaskService
  readonly #contextBuilder: ContextBuilder
  readonly #llm: LLMClient
  readonly #agentActorId: string

  #isRunning = false

  constructor(opts: {
    store: EventStore
    taskService: TaskService
    contextBuilder: ContextBuilder
    llm: LLMClient
    agentActorId: string
  }) {
    this.#store = opts.store
    this.#taskService = opts.taskService
    this.#contextBuilder = opts.contextBuilder
    this.#llm = opts.llm
    this.#agentActorId = opts.agentActorId
  }

  start(): void {
    this.#isRunning = true
  }

  stop(): void {
    this.#isRunning = false
  }

  get isRunning(): boolean {
    return this.#isRunning
  }

  async handleTask(taskId: string): Promise<{ taskId: string; planId: string; plan: Plan }> {
    const task = this.#taskService.getTask(taskId)
    if (!task) {
      throw new Error(`未找到任务：${taskId}`)
    }

    const messages = this.#contextBuilder.buildTaskMessages(task)
    const raw = await this.#llm.complete({ profile: 'fast', messages, maxTokens: 1024 })

    let plan: Plan
    try {
      const parsed = JSON.parse(raw) as unknown
      plan = PlanSchema.parse(parsed)
    } catch {
      plan = fallbackPlan(task, raw)
    }

    const planId = `plan_${nanoid(12)}`
    this.#store.append(taskId, [
      {
        type: 'AgentPlanPosted',
        payload: {
          taskId,
          planId,
          plan,
          authorActorId: this.#agentActorId
        }
      }
    ])

    return { taskId, planId, plan }
  }
}

