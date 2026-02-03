// Task service: encapsulates task use cases (create, list, open thread, etc.)
// Adapters should call services, not EventStore directly

import { nanoid } from 'nanoid'
import type { EventStore, StoredEvent, TaskPriority, ArtifactRef } from '../domain/index.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'
import { runProjection } from './projector.js'

// ============================================================================
// Projection Types
// ============================================================================

// Read model: denormalized task data for fast queries
export type TaskView = {
  taskId: string
  title: string
  intent: string
  createdBy: string
  agentId: string
  priority: TaskPriority
  status: 'open' | 'in_progress' | 'awaiting_review' | 'done' | 'canceled'
  artifactRefs?: ArtifactRef[]
  currentPlanId?: string
  pendingProposals: string[]
  appliedProposals: string[]
  createdAt: string
  updatedAt: string
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
   * Post user feedback on a task.
   */
  postFeedback(taskId: string, feedback: string, targetProposalId?: string): void {
    this.#store.append(taskId, [
      {
        type: 'UserFeedbackPosted',
        payload: {
          taskId,
          feedback,
          targetProposalId,
          authorActorId: this.#currentActorId
        }
      }
    ])
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

  // ============================================================================
  // Private Methods
  // ============================================================================

  #reduceTasksProjection(state: TasksProjectionState, event: StoredEvent): TasksProjectionState {
    const tasks = state.tasks

    const findTaskIndex = (taskId: string): number => tasks.findIndex((t) => t.taskId === taskId)

    switch (event.type) {
      case 'TaskCreated': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx !== -1) return state

        tasks.push({
          taskId: event.payload.taskId,
          title: event.payload.title,
          intent: event.payload.intent ?? '',
          createdBy: event.payload.authorActorId,
          agentId: event.payload.agentId,
          priority: event.payload.priority ?? 'foreground',
          status: 'open',
          artifactRefs: event.payload.artifactRefs,
          pendingProposals: [],
          appliedProposals: [],
          createdAt: event.createdAt,
          updatedAt: event.createdAt
        })
        return state
      }
      case 'TaskStarted': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        task.status = 'in_progress'
        task.updatedAt = event.createdAt
        return state
      }
      case 'AgentPlanPosted': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        task.currentPlanId = event.payload.planId
        task.updatedAt = event.createdAt
        return state
      }
      case 'PatchProposed': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        if (!task.pendingProposals.includes(event.payload.proposalId)) {
          task.pendingProposals.push(event.payload.proposalId)
        }
        task.status = 'awaiting_review'
        task.updatedAt = event.createdAt
        return state
      }
      case 'PatchAccepted':
      case 'PatchApplied': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        const pendingIdx = task.pendingProposals.indexOf(event.payload.proposalId)
        if (pendingIdx !== -1) task.pendingProposals.splice(pendingIdx, 1)
        if (event.type === 'PatchApplied' && !task.appliedProposals.includes(event.payload.proposalId)) {
          task.appliedProposals.push(event.payload.proposalId)
        }
        task.updatedAt = event.createdAt
        return state
      }
      case 'PatchRejected': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        const pendingIdx = task.pendingProposals.indexOf(event.payload.proposalId)
        if (pendingIdx !== -1) task.pendingProposals.splice(pendingIdx, 1)
        task.status = 'in_progress'
        task.updatedAt = event.createdAt
        return state
      }
      case 'TaskCompleted': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        task.status = 'done'
        task.updatedAt = event.createdAt
        return state
      }
      case 'TaskFailed': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        task.status = 'done'
        task.updatedAt = event.createdAt
        return state
      }
      case 'TaskCanceled': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        task.status = 'canceled'
        task.updatedAt = event.createdAt
        return state
      }
      default:
        return state
    }
  }
}
