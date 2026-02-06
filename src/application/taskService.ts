// Task service: encapsulates task use cases (create, list, etc.)
// Adapters should call services, not EventStore directly

import { nanoid } from 'nanoid'
import type { EventStore, StoredEvent, TaskPriority, ArtifactRef } from '../domain/index.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'
import { runProjection } from './projector.js'

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
  
  // V1 Reserved: Subtask support
  parentTaskId?: string
  childTaskIds?: string[]
  
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
}

export class TaskService {
  readonly #store: EventStore
  readonly #currentActorId: string

  constructor(store: EventStore, currentActorId: string = DEFAULT_USER_ACTOR_ID) {
    this.#store = store
    this.#currentActorId = currentActorId
  }

  // Create new task event
  createTask(opts: CreateTaskOptions): { taskId: string } {
    const taskId = nanoid()
    this.#store.append(taskId, [
      {
        type: 'TaskCreated',
        payload: {
          taskId,
          title: opts.title,
          intent: opts.intent ?? '',
          priority: opts.priority ?? 'foreground',
          artifactRefs: opts.artifactRefs,
          agentId: opts.agentId,
          authorActorId: this.#currentActorId
        }
      }
    ])
    return { taskId }
  }

  // Build tasks projection from events
  listTasks(): TasksProjectionState {
    return runProjection<TasksProjectionState>({
      store: this.#store,
      name: 'tasks',
      defaultState: { tasks: [] },
      reduce: (state, event) => this.#reduceTasksProjection(state, event)
    })
  }

  // Get task by ID from projection
  getTask(taskId: string): TaskView | null {
    const state = this.listTasks()
    return state.tasks.find(t => t.taskId === taskId) ?? null
  }

  /**
   * Cancel a task.
   */
  cancelTask(taskId: string, reason?: string): void {
    this.#store.append(taskId, [
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
  pauseTask(taskId: string, reason?: string): void {
    this.#store.append(taskId, [
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
  resumeTask(taskId: string, reason?: string): void {
    this.#store.append(taskId, [
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
  addInstruction(taskId: string, instruction: string): void {
    this.#store.append(taskId, [
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

  // ============================================================================
  // Private Methods
  // ============================================================================

  // Check if state transition is valid
  #canTransition(currentStatus: string, eventType: string): boolean {
    // TaskInstructionAdded is a universal wake-up signal (7.1 requirement)
    if (eventType === 'TaskInstructionAdded') return true 
    
    switch (currentStatus) {
      case 'open':
        return ['TaskStarted', 'TaskCanceled'].includes(eventType)
      case 'in_progress':
        // TaskStarted allowed for idempotent restarts
        return ['UserInteractionRequested', 'TaskCompleted', 'TaskFailed', 'TaskCanceled', 'TaskPaused', 'TaskInstructionAdded', 'TaskStarted'].includes(eventType)
      case 'awaiting_user':
        return ['UserInteractionResponded', 'TaskCanceled'].includes(eventType)
      case 'paused':
        return ['TaskResumed', 'TaskCanceled'].includes(eventType)
      case 'done':
      case 'failed':
      case 'canceled':
        // Allow restart via TaskStarted (re-execution)
        return ['TaskStarted'].includes(eventType)
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
          parentTaskId: undefined,
          childTaskIds: undefined,
          createdAt: event.createdAt,
          updatedAt: event.createdAt
        })
        return { tasks }
      }
      case 'TaskStarted': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.#canTransition(task.status, event.type)) return state
        
        task.status = 'in_progress'
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'UserInteractionRequested': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.#canTransition(task.status, event.type)) return state

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
        if (!this.#canTransition(task.status, event.type)) return state

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
        if (!this.#canTransition(task.status, event.type)) return state

        task.status = 'done'
        task.pendingInteractionId = undefined
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskFailed': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.#canTransition(task.status, event.type)) return state

        task.status = 'failed'
        task.pendingInteractionId = undefined
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskCanceled': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.#canTransition(task.status, event.type)) return state

        task.status = 'canceled'
        task.pendingInteractionId = undefined
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskPaused': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.#canTransition(task.status, event.type)) return state

        task.status = 'paused'
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskResumed': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.#canTransition(task.status, event.type)) return state

        task.status = 'in_progress'
        task.updatedAt = event.createdAt
        return { tasks }
      }
      case 'TaskInstructionAdded': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!this.#canTransition(task.status, event.type)) return state

        // If task was done/failed/canceled/paused, move back to in_progress
        // If already in_progress, stay in_progress
        task.status = 'in_progress'
        task.updatedAt = event.createdAt
        return { tasks }
      }
      default:
        return state
    }
  }
}
