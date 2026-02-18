import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { JsonlEventStore } from '../src/infrastructure/persistence/jsonlEventStore.js'
import { TaskService } from '../src/application/services/taskService.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from './helpers/actorIds.js'

describe('TaskService projection checkpoint', () => {
  test('listTasks uses and advances projection cursor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    await store.ensureSchema()

    await store.append('t1', [
      {
        type: 'TaskCreated',
        payload: { taskId: 't1', title: 'T1', intent: '', priority: 'foreground', agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID }
      }
    ])

    const svc = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const s1 = await svc.listTasks()
    expect(s1.tasks.map((t) => t.taskId)).toEqual(['t1'])

    const p1 = await store.getProjection('tasks', { tasks: [], currentTaskId: null })
    expect(p1.cursorEventId).toBeGreaterThan(0)

    const s2 = await svc.listTasks()
    expect(s2.tasks.map((t) => t.taskId)).toEqual(['t1'])

    rmSync(dir, { recursive: true, force: true })
  })

  test('projects TaskTodoUpdated into task view todos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    await store.ensureSchema()

    const svc = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const { taskId } = await svc.createTask({
      title: 'Todo projection task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await svc.updateTodoList(taskId, [
      { title: 'First', status: 'pending' },
      { title: 'Second', status: 'completed' }
    ])

    const projected = await svc.getTask(taskId)
    expect(projected?.todos).toEqual([
      { id: 'todo-first-1', title: 'First', status: 'pending', description: undefined },
      { id: 'todo-second-2', title: 'Second', status: 'completed', description: undefined }
    ])

    rmSync(dir, { recursive: true, force: true })
  })
})
