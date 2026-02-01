import React from 'react'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import { render } from 'ink-testing-library'
import { EventStore } from '../src/core/eventStore.js'
import { MainTui } from '../src/tui/main.js'

describe('TUI', () => {
  test('renders tasks list', async () => {
    const db = new DatabaseSync(':memory:')
    const store = new EventStore(db)
    store.ensureSchema()
    store.append('t1', [{ type: 'TaskCreated', payload: { taskId: 't1', title: 'hello' } }])
    const app = { baseDir: '/', dbPath: ':memory:', store }

    const { lastFrame } = render(<MainTui app={app} />)

    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toMatch(/Tasks/)
    expect(lastFrame()).toMatch(/hello/)
  })
})
