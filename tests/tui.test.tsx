import React from 'react'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { render } from 'ink-testing-library'
import { FakeLLMClient } from '../src/infra/fakeLLMClient.js'
import { createApp } from '../src/app/createApp.js'
import { MainTui } from '../src/tui/main.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

describe('TUI', () => {
  test('renders tasks list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const eventsPath = join(dir, 'events.jsonl')
    const auditLogPath = join(dir, 'audit.jsonl')
    const conversationsPath = join(dir, 'conversations.jsonl')
    
    const baseDir = dir
    const app = createApp({
      baseDir,
      eventsPath,
      auditLogPath,
      conversationsPath,
      currentActorId: DEFAULT_USER_ACTOR_ID,
      llm: new FakeLLMClient(),
    })

    app.store.append('t1', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't1',
          title: 'hello',
          intent: '',
          priority: 'foreground' as const,
          agentId: app.runtimeManager.defaultAgentId,
          authorActorId: DEFAULT_USER_ACTOR_ID,
        },
      },
    ])

    const { lastFrame, unmount } = render(<MainTui app={app} />)

    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toMatch(/Tasks/)
    expect(lastFrame()).toMatch(/hello/)

    unmount()
    rmSync(dir, { recursive: true, force: true })
  })
})
