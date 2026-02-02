import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { TaskService } from '../src/application/taskService.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

describe('TaskService projection checkpoint', () => {
  test('listTasks uses and advances projection cursor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    store.append('t1', [
      {
        type: 'TaskCreated',
        payload: { taskId: 't1', title: 'T1', intent: '', priority: 'foreground', authorActorId: DEFAULT_USER_ACTOR_ID }
      }
    ])

    const svc = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const s1 = svc.listTasks()
    expect(s1.tasks.map((t) => t.taskId)).toEqual(['t1'])

    const p1 = store.getProjection('tasks', { tasks: [], currentTaskId: null })
    expect(p1.cursorEventId).toBeGreaterThan(0)

    const s2 = svc.listTasks()
    expect(s2.tasks.map((t) => t.taskId)).toEqual(['t1'])

    rmSync(dir, { recursive: true, force: true })
  })
})

