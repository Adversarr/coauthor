/**
 * Application Layer - Task Service
 *
 * Encapsulates task-related use cases.
 * CLI and other adapters should use this service instead of calling EventStore directly.
 */

import { nanoid } from 'nanoid'
import type { EventStore, StoredEvent, TaskPriority, ArtifactRef } from '../domain/index.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'

// ============================================================================
// Projection Types
// ============================================================================

export type TaskView = {
  taskId: string
  title: string
  intent: string
  createdBy: string
  assignedTo?: string
  priority: TaskPriority
  status: 'open' | 'claimed' | 'in_progress' | 'awaiting_review' | 'done' | 'blocked' | 'canceled'
  artifactRefs?: ArtifactRef[]
  currentPlanId?: string
  pendingProposals: string[]
  appliedProposals: string[]
  createdAt: string
  updatedAt: string
}

export type TasksProjectionState = {
  tasks: TaskView[]
  currentTaskId: string | null
}

// ============================================================================
// Task Service
// ============================================================================

export type CreateTaskOptions = {
  intent?: string
  priority?: TaskPriority
  artifactRefs?: ArtifactRef[]
}

export class TaskService {
  readonly #store: EventStore
  readonly #currentActorId: string

  constructor(store: EventStore, currentActorId: string = DEFAULT_USER_ACTOR_ID) {
    this.#store = store
    this.#currentActorId = currentActorId
  }

  /**
   * Create a new task.
   */
  createTask(title: string, opts?: CreateTaskOptions): { taskId: string } {
    const taskId = nanoid()
    this.#store.append(taskId, [
      {
        type: 'TaskCreated',
        payload: {
          taskId,
          title,
          intent: opts?.intent ?? '',
          priority: opts?.priority ?? 'foreground',
          artifactRefs: opts?.artifactRefs,
          authorActorId: this.#currentActorId
        }
      }
    ])
    return { taskId }
  }

  /**
   * List all tasks with their current state.
   */
  listTasks(): TasksProjectionState {
    const { state } = this.#store.getProjection<TasksProjectionState>('tasks_v2', {
      tasks: [],
      currentTaskId: null
    })

    // Rebuild from events if needed
    const events = this.#store.readAll(0)
    return this.#buildTasksProjection(events, state)
  }

  /**
   * Get a specific task by ID.
   */
  getTask(taskId: string): TaskView | null {
    const state = this.listTasks()
    return state.tasks.find(t => t.taskId === taskId) ?? null
  }

  /**
   * Open a thread (set current task).
   */
  openThread(taskId: string): void {
    this.#store.append(taskId, [
      {
        type: 'ThreadOpened',
        payload: {
          taskId,
          authorActorId: this.#currentActorId
        }
      }
    ])
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

  #buildTasksProjection(events: StoredEvent[], _initialState: TasksProjectionState): TasksProjectionState {
    const tasksMap = new Map<string, TaskView>()
    let currentTaskId: string | null = null

    for (const event of events) {
      switch (event.type) {
        case 'TaskCreated': {
          const p = event.payload
          tasksMap.set(p.taskId, {
            taskId: p.taskId,
            title: p.title,
            intent: p.intent ?? '',
            createdBy: p.authorActorId,
            priority: p.priority ?? 'foreground',
            status: 'open',
            artifactRefs: p.artifactRefs,
            pendingProposals: [],
            appliedProposals: [],
            createdAt: event.createdAt,
            updatedAt: event.createdAt
          })
          break
        }
        case 'ThreadOpened': {
          currentTaskId = event.payload.taskId
          break
        }
        case 'TaskClaimed': {
          const task = tasksMap.get(event.payload.taskId)
          if (task) {
            task.status = 'claimed'
            task.assignedTo = event.payload.claimedBy
            task.updatedAt = event.createdAt
          }
          break
        }
        case 'TaskStarted': {
          const task = tasksMap.get(event.payload.taskId)
          if (task) {
            task.status = 'in_progress'
            task.updatedAt = event.createdAt
          }
          break
        }
        case 'AgentPlanPosted': {
          const task = tasksMap.get(event.payload.taskId)
          if (task) {
            task.currentPlanId = event.payload.planId
            task.updatedAt = event.createdAt
          }
          break
        }
        case 'PatchProposed': {
          const task = tasksMap.get(event.payload.taskId)
          if (task) {
            task.pendingProposals.push(event.payload.proposalId)
            task.status = 'awaiting_review'
            task.updatedAt = event.createdAt
          }
          break
        }
        case 'PatchAccepted':
        case 'PatchApplied': {
          const task = tasksMap.get(event.payload.taskId)
          if (task) {
            const idx = task.pendingProposals.indexOf(event.payload.proposalId)
            if (idx !== -1) {
              task.pendingProposals.splice(idx, 1)
            }
            if (event.type === 'PatchApplied') {
              task.appliedProposals.push(event.payload.proposalId)
            }
            task.updatedAt = event.createdAt
          }
          break
        }
        case 'PatchRejected': {
          const task = tasksMap.get(event.payload.taskId)
          if (task) {
            const idx = task.pendingProposals.indexOf(event.payload.proposalId)
            if (idx !== -1) {
              task.pendingProposals.splice(idx, 1)
            }
            task.status = 'in_progress'
            task.updatedAt = event.createdAt
          }
          break
        }
        case 'TaskCompleted': {
          const task = tasksMap.get(event.payload.taskId)
          if (task) {
            task.status = 'done'
            task.updatedAt = event.createdAt
          }
          break
        }
        case 'TaskFailed': {
          const task = tasksMap.get(event.payload.taskId)
          if (task) {
            task.status = 'done' // or could use a 'failed' status
            task.updatedAt = event.createdAt
          }
          break
        }
        case 'TaskCanceled': {
          const task = tasksMap.get(event.payload.taskId)
          if (task) {
            task.status = 'canceled'
            task.updatedAt = event.createdAt
          }
          break
        }
        case 'TaskBlocked': {
          const task = tasksMap.get(event.payload.taskId)
          if (task) {
            task.status = 'blocked'
            task.updatedAt = event.createdAt
          }
          break
        }
      }
    }

    return {
      tasks: Array.from(tasksMap.values()),
      currentTaskId
    }
  }
}
