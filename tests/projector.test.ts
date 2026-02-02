import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { runProjection } from '../src/core/projector.js'
import { defaultTasksProjectionState, reduceTasksProjection } from '../src/core/projections.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

describe('Projection', () => {
  test('tasks projection advances cursor and is idempotent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    store.append('t1', [{ 
      type: 'TaskCreated', 
      payload: { taskId: 't1', title: 'T1', intent: '', priority: 'foreground' as const, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])
    store.append('t2', [{ 
      type: 'TaskCreated', 
      payload: { taskId: 't2', title: 'T2', intent: '', priority: 'foreground' as const, authorActorId: DEFAULT_USER_ACTOR_ID } 
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
