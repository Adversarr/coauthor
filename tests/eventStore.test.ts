import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

describe('EventStore', () => {
  test('append/readStream keeps seq ordering', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    store.append('t1', [{ 
      type: 'TaskCreated', 
      payload: { taskId: 't1', title: 'hello', intent: '', priority: 'foreground' as const, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])
    store.append('t1', [{ 
      type: 'ThreadOpened', 
      payload: { taskId: 't1', authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])

    const events = store.readStream('t1', 1)
    expect(events.map((e) => e.seq)).toEqual([1, 2])
    expect(events[0]?.type).toBe('TaskCreated')
    expect(events[1]?.type).toBe('ThreadOpened')

    rmSync(dir, { recursive: true, force: true })
  })

  test('readAll returns globally ordered events by id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    store.append('a', [{ 
      type: 'TaskCreated', 
      payload: { taskId: 'a', title: 'A', intent: '', priority: 'foreground' as const, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])
    store.append('b', [{ 
      type: 'TaskCreated', 
      payload: { taskId: 'b', title: 'B', intent: '', priority: 'foreground' as const, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])

    const events = store.readAll(0)
    expect(events.length).toBe(2)
    expect(events[0]!.id).toBeLessThan(events[1]!.id)

    rmSync(dir, { recursive: true, force: true })
  })
})
