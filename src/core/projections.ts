import type { StoredEvent } from '../domain/events.js'

export type TasksProjectionState = {
  tasks: Array<{
    taskId: string
    title: string
    createdAt: string
  }>
  currentTaskId: string | null
}

export const defaultTasksProjectionState: TasksProjectionState = {
  tasks: [],
  currentTaskId: null
}

export function reduceTasksProjection(state: TasksProjectionState, event: StoredEvent): TasksProjectionState {
  switch (event.type) {
    case 'TaskCreated': {
      if (state.tasks.some((t) => t.taskId === event.payload.taskId)) return state
      return {
        ...state,
        tasks: [
          ...state.tasks,
          { taskId: event.payload.taskId, title: event.payload.title, createdAt: event.createdAt }
        ]
      }
    }
    case 'ThreadOpened': {
      return { ...state, currentTaskId: event.payload.taskId }
    }
    default:
      return state
  }
}

export type ThreadProjectionState = {
  threads: Record<
    string,
    {
      taskId: string
      proposals: Array<{
        proposalId: string
        targetPath: string
        patchText: string
        createdAt: string
        appliedAt: string | null
      }>
    }
  >
}

export const defaultThreadProjectionState: ThreadProjectionState = {
  threads: {}
}

export function reduceThreadProjection(state: ThreadProjectionState, event: StoredEvent): ThreadProjectionState {
  switch (event.type) {
    case 'PatchProposed': {
      const taskId = event.payload.taskId
      const current = state.threads[taskId] ?? { taskId, proposals: [] }
      if (current.proposals.some((p) => p.proposalId === event.payload.proposalId)) return state
      return {
        ...state,
        threads: {
          ...state.threads,
          [taskId]: {
            ...current,
            proposals: [
              ...current.proposals,
              {
                proposalId: event.payload.proposalId,
                targetPath: event.payload.targetPath,
                patchText: event.payload.patchText,
                createdAt: event.createdAt,
                appliedAt: null
              }
            ]
          }
        }
      }
    }
    case 'PatchApplied': {
      const taskId = event.payload.taskId
      const current = state.threads[taskId]
      if (!current) return state
      return {
        ...state,
        threads: {
          ...state.threads,
          [taskId]: {
            ...current,
            proposals: current.proposals.map((p) =>
              p.proposalId === event.payload.proposalId ? { ...p, appliedAt: event.payload.appliedAt } : p
            )
          }
        }
      }
    }
    default:
      return state
  }
}

