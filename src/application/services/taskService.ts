// Task service: encapsulates task use cases (create, list, etc.)
// Adapters should call services, not EventStore directly

import { nanoid } from 'nanoid'
import type { ArtifactRef, TaskPriority, TaskTodoItem, TaskTodoStatus } from '../../core/entities/task.js'
import { DEFAULT_USER_ACTOR_ID } from '../../core/entities/actor.js'
import type { StoredEvent } from '../../core/events/events.js'
import type { EventStore } from '../../core/ports/eventStore.js'
import { runProjection } from '../projections/projector.js'

// ============================================================================
// Projection Types
// ============================================================================

/**
 * TaskView - Read model for fast task queries.
 * Projected from DomainEvents via reducer.
 */
export type TaskView = {
  taskId: string
  title: string
  intent: string
  createdBy: string
  agentId: string                 // V0: Specify processing Agent directly upon creation
  priority: TaskPriority
  status: 'open' | 'in_progress' | 'awaiting_user' | 'paused' | 'done' | 'failed' | 'canceled'
  artifactRefs?: ArtifactRef[]
  
  // UIP Interaction State
  pendingInteractionId?: string   // ID of the interaction currently awaiting a response
  lastInteractionId?: string      // ID of the last interaction
  
  // Subtask support
  parentTaskId?: string
  childTaskIds?: string[]
  
  // Terminal output
  summary?: string                // From TaskCompleted
  failureReason?: string          // From TaskFailed
  todos?: TaskTodoItem[]
  
  createdAt: string
  updatedAt: string               // Time of the last event
}

export type TasksProjectionState = {
  tasks: TaskView[]
}

// ============================================================================
// Task Service
// ============================================================================

export type CreateTaskOptions = {
  title: string
  intent?: string
  priority?: TaskPriority
  artifactRefs?: ArtifactRef[]
  agentId: string
  /** Set for subtasks spawned by another task. */
  parentTaskId?: string
  /** Override the default author actor (e.g. agent-created subtasks). */
  authorActorId?: string
}

export type TaskTodoItemInput = {
  id?: string
  title: string
  description?: string
  status?: TaskTodoStatus
}

export type TaskTodoUpdateResult = TaskTodoItem | 'All todo complete'

export class TaskService {
  readonly #store: EventStore
  readonly #currentActorId: string
  readonly #defaultPriority: TaskPriority

  constructor(
    store: EventStore,
    currentActorId: string = DEFAULT_USER_ACTOR_ID,
    defaultPriority: TaskPriority = 'foreground'
  ) {
    this.#store = store
    this.#currentActorId = currentActorId
    this.#defaultPriority = defaultPriority
  }

  // Create new task event
  async createTask(opts: CreateTaskOptions): Promise<{ taskId: string }> {
    const taskId = nanoid()
    await this.#store.append(taskId, [
      {
        type: 'TaskCreated',
        payload: {
          taskId,
          title: opts.title,
          intent: opts.intent ?? '',
          priority: opts.priority ?? this.#defaultPriority,
          artifactRefs: opts.artifactRefs,
          agentId: opts.agentId,
          parentTaskId: opts.parentTaskId,
          authorActorId: opts.authorActorId ?? this.#currentActorId
        }
      }
    ])
    return { taskId }
  }

  // Build tasks projection from events
  async listTasks(): Promise<TasksProjectionState> {
    return runProjection<TasksProjectionState>({
      store: this.#store,
      name: 'tasks',
      defaultState: { tasks: [] },
      reduce: (state, event) => this.#reduceTasksProjection(state, event)
    })
  }

  // Get task by ID from projection
  async getTask(taskId: string): Promise<TaskView | null> {
    const state = await this.listTasks()
    return state.tasks.find(t => t.taskId === taskId) ?? null
  }

  /**
   * Cancel a task.
   */
  async cancelTask(taskId: string, reason?: string): Promise<void> {
    const task = await this.getTask(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (!this.canTransition(task.status, 'TaskCanceled')) {
      throw new Error(`Invalid transition: cannot cancel task in state ${task.status}`)
    }

    await this.#store.append(taskId, [
      {
        type: 'TaskCanceled',
        payload: {
          taskId,
          reason,
          authorActorId: this.#currentActorId
        }
      }
    ])
  }

  /**
   * Pause a task.
   */
  async pauseTask(taskId: string, reason?: string): Promise<void> {
    const task = await this.getTask(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (!this.canTransition(task.status, 'TaskPaused')) {
      throw new Error(`Invalid transition: cannot pause task in state ${task.status}`)
    }

    await this.#store.append(taskId, [
      {
        type: 'TaskPaused',
        payload: {
          taskId,
          reason,
          authorActorId: this.#currentActorId
        }
      }
    ])
  }

  /**
   * Resume a task.
   */
  async resumeTask(taskId: string, reason?: string): Promise<void> {
    const task = await this.getTask(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (!this.canTransition(task.status, 'TaskResumed')) {
      throw new Error(`Invalid transition: cannot resume task in state ${task.status}`)
    }

    await this.#store.append(taskId, [
      {
        type: 'TaskResumed',
        payload: {
          taskId,
          reason,
          authorActorId: this.#currentActorId
        }
      }
    ])
  }

  /**
   * Add an instruction to a task (refinement).
   */
  async addInstruction(taskId: string, instruction: string): Promise<void> {
    const task = await this.getTask(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (!this.canTransition(task.status, 'TaskInstructionAdded')) {
      throw new Error(`Invalid transition: cannot add instruction to task in state ${task.status}`)
    }

    await this.#store.append(taskId, [
      {
        type: 'TaskInstructionAdded',
        payload: {
          taskId,
          instruction,
          authorActorId: this.#currentActorId
        }
      }
    ])
  }

  /**
   * Replace the full todo list for a task and return the next pending item.
   *
   * This is a full-list upsert: each call sends the authoritative list.
   */
  async updateTodoList(taskId: string, todos: TaskTodoItemInput[]): Promise<TaskTodoUpdateResult> {
    const task = await this.getTask(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (!this.canTransition(task.status, 'TaskTodoUpdated')) {
      throw new Error(`Invalid transition: cannot update todos for task in state ${task.status}`)
    }

    const normalizedTodos = normalizeTodoItems(todos)
    await this.#store.append(taskId, [
      {
        type: 'TaskTodoUpdated',
        payload: {
          taskId,
          todos: normalizedTodos,
          authorActorId: this.#currentActorId
        }
      }
    ])

    const nextPending = normalizedTodos.find((todo) => todo.status === 'pending')
    return nextPending ?? 'All todo complete'
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  // Check if state transition is valid
  canTransition(currentStatus: string, eventType: string): boolean {
    // TaskInstructionAdded allowed from most states, but NOT from paused
    // or canceled — those require explicit resume/restart (CC-004).
    if (eventType === 'TaskInstructionAdded') {
      return !['paused', 'canceled'].includes(currentStatus)
    }
    if (eventType === 'TaskTodoUpdated') {
      return currentStatus !== 'canceled'
    }
    
    switch (currentStatus) {
      case 'open':
        return ['TaskStarted', 'TaskCanceled'].includes(eventType)
      case 'in_progress':
        // TaskStarted allowed for idempotent restarts
        return ['UserInteractionRequested', 'TaskCompleted', 'TaskFailed', 'TaskCanceled', 'TaskPaused', 'TaskInstructionAdded', 'TaskStarted'].includes(eventType)
      case 'awaiting_user':
        return ['UserInteractionResponded', 'TaskCanceled'].includes(eventType)
      case 'paused':
        // Allow TaskFailed from paused so error recovery works (CC-003)
        return ['TaskResumed', 'TaskCanceled', 'TaskFailed'].includes(eventType)
      case 'done':
        // Allow restart from done only (explicit re-execution)
        return ['TaskStarted'].includes(eventType)
      case 'failed':
      case 'canceled':
        // Disallow TaskStarted from terminal error states (RD-003).
        // To re-run, create a new task. This prevents zombie restarts.
        return false
      default:
        return false
    }
  }

  // Reducer for tasks projection
  #reduceTasksProjection(state: TasksProjectionState, event: StoredEvent): TasksProjectionState {
    const tasks = [...state.tasks]
    const findTaskIndex = (id: string) => tasks.findIndex(t => t.taskId === id)

    switch (event.type) {
      case 'TaskCreated': {
        const parentId = event.payload.parentTaskId
        tasks.push({
          taskId: event.payload.taskId,
          title: event.payload.title,
          intent: event.payload.intent ?? '',
          createdBy: event.payload.authorActorId,
          agentId: event.payload.agentId,
          priority: event.payload.priority ?? 'foreground',
          status: 'open',
          artifactRefs: event.payload.artifactRefs,
          pendingInteractionId: undefined,
          lastInteractionId: undefined,
          parentTaskId: parentId,
          childTaskIds: undefined,
          todos: undefined,
          createdAt: event.createdAt,
          updatedAt: event.createdAt
        })
        // Maintain parent → child link
        if (parentId) {
          const parentIdx = findTaskIndex(parentId)
          if (parentIdx !== -1) {
            const parent = tasks[parentIdx]!
            const children = parent.childTaskIds ?? []
            if (!children.includes(event.payload.taskId)) {
              parent.childTaskIds = [...children, event.payload.taskId]
            }
          }
        }
        return { tasks }
      }
      case 'TaskStarted': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.canTransition(task.status, event.type)) return state
        
        task.status = 'in_progress'
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'UserInteractionRequested': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.canTransition(task.status, event.type)) return state

        task.status = 'awaiting_user'
        task.pendingInteractionId = event.payload.interactionId
        task.lastInteractionId = event.payload.interactionId
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'UserInteractionResponded': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.canTransition(task.status, event.type)) return state

        // Only clear if this response is for the pending interaction
        if (task.pendingInteractionId === event.payload.interactionId) {
          task.status = 'in_progress'
          task.pendingInteractionId = undefined
        }
        task.lastInteractionId = event.payload.interactionId
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskCompleted': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.canTransition(task.status, event.type)) return state

        task.status = 'done'
        task.summary = event.payload.summary
        task.pendingInteractionId = undefined
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskFailed': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.canTransition(task.status, event.type)) return state

        task.status = 'failed'
        task.failureReason = event.payload.reason
        task.pendingInteractionId = undefined
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskCanceled': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.canTransition(task.status, event.type)) return state

        task.status = 'canceled'
        task.pendingInteractionId = undefined
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskPaused': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.canTransition(task.status, event.type)) return state

        task.status = 'paused'
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskResumed': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.canTransition(task.status, event.type)) return state

        task.status = 'in_progress'
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskInstructionAdded': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.canTransition(task.status, event.type)) return state

        // Only move to in_progress from states where it makes sense.
        // Paused and canceled tasks are blocked by canTransition (CC-004).
        // awaiting_user stays awaiting_user — instruction doesn't cancel UIP.
        if (['open', 'done', 'failed'].includes(task.status)) {
          task.status = 'in_progress'
        }
        // in_progress stays in_progress (already executing)
        // awaiting_user stays awaiting_user (CC-004: no silent override)
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskTodoUpdated': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.canTransition(task.status, event.type)) return state

        task.todos = event.payload.todos
        task.updatedAt = event.createdAt
        return { tasks }
      }
      default:
        return state
    }
  }
}

function normalizeTodoItems(input: TaskTodoItemInput[]): TaskTodoItem[] {
  if (!Array.isArray(input)) {
    throw new Error('todos must be an array')
  }
  const normalized = input.map((todo, index) => normalizeTodoItem(todo, index))
  return dedupeTodoIds(normalized)
}

function normalizeTodoItem(input: TaskTodoItemInput, index: number): TaskTodoItem {
  if (!input || typeof input !== 'object') {
    throw new Error(`Invalid todo at index ${index}: expected object`)
  }

  if (typeof input.title !== 'string') {
    throw new Error(`Invalid todo at index ${index}: title must be a string`)
  }
  const title = input.title.trim()
  if (!title) {
    throw new Error(`Invalid todo at index ${index}: title cannot be empty`)
  }

  const rawDescription = input.description
  if (rawDescription !== undefined && typeof rawDescription !== 'string') {
    throw new Error(`Invalid todo at index ${index}: description must be a string`)
  }
  const description = rawDescription?.trim() || undefined

  const status: TaskTodoStatus = input.status ?? 'pending'
  if (status !== 'pending' && status !== 'completed') {
    throw new Error(`Invalid todo at index ${index}: status must be pending or completed`)
  }

  const rawId = typeof input.id === 'string' ? input.id.trim() : ''
  const id = rawId || buildTodoIdFromTitle(title, index)

  return {
    id,
    title,
    description,
    status
  }
}

function buildTodoIdFromTitle(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const safeSlug = slug || 'item'
  return `todo-${safeSlug}-${index + 1}`
}

function dedupeTodoIds(todos: TaskTodoItem[]): TaskTodoItem[] {
  const used = new Set<string>()
  return todos.map((todo) => {
    const base = todo.id
    let candidate = base
    let suffix = 2
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    used.add(candidate)
    return { ...todo, id: candidate }
  })
}
