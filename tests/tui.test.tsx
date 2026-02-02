import React from 'react'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { render } from 'ink-testing-library'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { MainTui } from '../src/tui/main.js'
import { TaskService, PatchService, EventService } from '../src/application/index.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

describe('TUI', () => {
  test('renders tasks list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const eventsPath = join(dir, 'events.jsonl')
    const store = new JsonlEventStore({ eventsPath })
    store.ensureSchema()
    store.append('t1', [{ 
      type: 'TaskCreated', 
      payload: { 
        taskId: 't1', 
        title: 'hello',
        intent: '',
        priority: 'foreground' as const,
        authorActorId: DEFAULT_USER_ACTOR_ID 
      } 
    }])
    
    const baseDir = dir
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const patchService = new PatchService(store, baseDir, DEFAULT_USER_ACTOR_ID)
    const eventService = new EventService(store)
    
    const app = { 
      baseDir, 
      storePath: eventsPath, 
      store,
      taskService,
      patchService,
      eventService
    }

    const { lastFrame } = render(<MainTui app={app} />)

    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toMatch(/Tasks/)
    expect(lastFrame()).toMatch(/hello/)

    rmSync(dir, { recursive: true, force: true })
  })
})
