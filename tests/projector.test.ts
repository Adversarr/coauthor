import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { JsonlEventStore } from '../src/infrastructure/persistence/jsonlEventStore.js'
import { runProjection } from '../src/application/projections/projector.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from './helpers/actorIds.js'
import type { StoredEvent } from '../src/core/events/events.js'

// Use TaskService's projection instead of the deprecated one
type DeprecatedTasksProjectionState = {
  tasks: Array<{
    taskId: string
    title: string
    createdAt: string
  }>
  currentTaskId: string | null
}

const defaultTasksProjectionState: DeprecatedTasksProjectionState = {
  tasks: [],
  currentTaskId: null
}

function reduceTasksProjection(state: DeprecatedTasksProjectionState, event: StoredEvent): DeprecatedTasksProjectionState {
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
    case 'TaskStarted': {
      return { ...state, currentTaskId: event.payload.taskId }
    }
    default:
      return state
  }
}

describe('Projection', () => {
  test('tasks projection advances cursor and is idempotent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    await store.ensureSchema()

    await store.append('t1', [{ 
      type: 'TaskCreated', 
      payload: { taskId: 't1', title: 'T1', intent: '', priority: 'foreground' as const, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])
    await store.append('t2', [{ 
      type: 'TaskCreated', 
      payload: { taskId: 't2', title: 'T2', intent: '', priority: 'foreground' as const, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])

    const s1 = await runProjection({
      store,
      name: 'tasks',
      defaultState: defaultTasksProjectionState,
      reduce: reduceTasksProjection
    })
    expect(s1.tasks.map((t) => t.taskId).sort()).toEqual(['t1', 't2'])

    const s2 = await runProjection({
      store,
      name: 'tasks',
      defaultState: defaultTasksProjectionState,
      reduce: reduceTasksProjection
    })
    expect(s2.tasks.length).toBe(2)

    rmSync(dir, { recursive: true, force: true })
  })
})
