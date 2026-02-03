import { describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'
import type { StoredEvent } from '../src/domain/events.js'

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
      payload: { taskId: 't1', title: 'hello', intent: '', priority: 'foreground' as const, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])
    store.append('t1', [{ 
      type: 'UserFeedbackPosted', 
      payload: { taskId: 't1', feedback: 'looks good', authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])

    const events = store.readStream('t1', 1)
    expect(events.map((e) => e.seq)).toEqual([1, 2])
    expect(events[0]?.type).toBe('TaskCreated')
    expect(events[1]?.type).toBe('UserFeedbackPosted')

    rmSync(dir, { recursive: true, force: true })
  })

  test('events$ Observable emits on append', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    const received: StoredEvent[] = []
    const subscription = store.events$.subscribe((e) => received.push(e))

    store.append('t1', [{ 
      type: 'TaskCreated', 
      payload: { taskId: 't1', title: 'hello', intent: '', priority: 'foreground' as const, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])
    store.append('t2', [{ 
      type: 'TaskCreated', 
      payload: { taskId: 't2', title: 'world', intent: '', priority: 'background' as const, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])

    // Should have received 2 events
    expect(received.length).toBe(2)
    expect(received[0]?.type).toBe('TaskCreated')
    expect(received[0]?.payload.taskId).toBe('t1')
    expect(received[1]?.payload.taskId).toBe('t2')

    subscription.unsubscribe()
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
      payload: { taskId: 'a', title: 'A', intent: '', priority: 'foreground' as const, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])
    store.append('b', [{ 
      type: 'TaskCreated', 
      payload: { taskId: 'b', title: 'B', intent: '', priority: 'foreground' as const, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID } 
    }])

    const events = store.readAll(0)
    expect(events.length).toBe(2)
    expect(events[0]!.id).toBeLessThan(events[1]!.id)

    rmSync(dir, { recursive: true, force: true })
  })

  test('saveProjection overwrites instead of appending (no bloat)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    // Save projection multiple times
    store.saveProjection('test', 1, { count: 1 })
    store.saveProjection('test', 2, { count: 2 })
    store.saveProjection('test', 3, { count: 3 })
    store.saveProjection('other', 5, { foo: 'bar' })

    // Read the file directly to verify no bloat
    const raw = readFileSync(join(dir, 'projections.jsonl'), 'utf8')
    const lines = raw.split('\n').filter(Boolean)

    // Should only have 2 lines (one per projection name), not 4
    expect(lines.length).toBe(2)

    // Verify the values are correct
    const { cursorEventId, state } = store.getProjection('test', { count: 0 })
    expect(cursorEventId).toBe(3)
    expect(state).toEqual({ count: 3 })

    const other = store.getProjection('other', { foo: '' })
    expect(other.cursorEventId).toBe(5)
    expect(other.state).toEqual({ foo: 'bar' })

    rmSync(dir, { recursive: true, force: true })
  })
})
