import React from 'react'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import { FakeLLMClient } from '../src/infrastructure/llm/fakeLLMClient.js'
import { createApp } from '../src/interfaces/app/createApp.js'
import { MainTui } from '../src/interfaces/tui/main.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from './helpers/actorIds.js'
import type { App } from '../src/interfaces/app/createApp.js'
import type { DomainEvent } from '../src/core/events/events.js'

// ============================================================================
// Helpers
// ============================================================================

import type { TaskView } from '../src/interfaces/tui/types.js'

// ============================================================================
// Helpers
// ============================================================================

function makeTasks(): TaskView[] {
  return [
    { taskId: 'r1', title: 'Root 1', status: 'open', agentId: 'a1', depth: 0 },
    { taskId: 'r2', title: 'Root 2', status: 'in_progress', agentId: 'a1', depth: 0 },
    { taskId: 'c1', title: 'Child 1', status: 'done', agentId: 'a1', parentTaskId: 'r1', depth: 1 },
    { taskId: 'c2', title: 'Child 2', status: 'in_progress', agentId: 'a1', parentTaskId: 'r1', depth: 1 },
    { taskId: 'gc1', title: 'Grandchild', status: 'open', agentId: 'a1', parentTaskId: 'c1', depth: 2 },
  ]
}

async function createTestApp(): Promise<{ app: App; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'seed-tui-'))
  const app = await createApp({
    baseDir: dir,
    eventsPath: join(dir, 'events.jsonl'),
    auditLogPath: join(dir, 'audit.jsonl'),
    conversationsPath: join(dir, 'conversations.jsonl'),
    currentActorId: DEFAULT_USER_ACTOR_ID,
    llm: new FakeLLMClient(),
  })
  return { app, dir }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ============================================================================
// Tests
// ============================================================================

describe('TUI', () => {
  test('renders tasks list', async () => {
    const { app, dir } = await createTestApp()

    await app.store.append('t1', [
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
    await wait(200)

    expect(lastFrame()).toMatch(/Tasks/)
    expect(lastFrame()).toMatch(/hello/)

    unmount()
    rmSync(dir, { recursive: true, force: true })
  })

  test('shows todo summary and next pending item in focused task detail', async () => {
    const { app, dir } = await createTestApp()
    const agentId = app.runtimeManager.defaultAgentId

    await app.store.append('t1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 't1',
        title: 'Todo task',
        intent: '',
        priority: 'foreground' as const,
        agentId,
        authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])
    await app.store.append('t1', [{
      type: 'TaskTodoUpdated',
      payload: {
        taskId: 't1',
        todos: [
          { id: 'todo-1', title: 'Write tests', status: 'pending' as const },
          { id: 'todo-2', title: 'Ship release', status: 'completed' as const }
        ],
        authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    const { lastFrame, unmount } = render(<MainTui app={app} />)
    await wait(200)

    const frame = lastFrame()!
    expect(frame).toContain('Todos: 1 pending / 1 completed')
    expect(frame).toContain('Next: Write tests')
    expect(frame).toContain('[x] Ship release')

    unmount()
    rmSync(dir, { recursive: true, force: true })
  })

  test('shows empty todo state when focused task has no todos', async () => {
    const { app, dir } = await createTestApp()
    const agentId = app.runtimeManager.defaultAgentId

    await app.store.append('t1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 't1',
        title: 'No todo task',
        intent: '',
        priority: 'foreground' as const,
        agentId,
        authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    const { lastFrame, unmount } = render(<MainTui app={app} />)
    await wait(200)

    expect(lastFrame()).toContain('Todos: No todos yet')

    unmount()
    rmSync(dir, { recursive: true, force: true })
  })

  test('displays subtask with tree prefix under parent', async () => {
    const { app, dir } = await createTestApp()
    const agentId = app.runtimeManager.defaultAgentId

    // Create parent
    await app.store.append('parent1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 'parent1', title: 'Parent Task', intent: '',
        priority: 'foreground' as const, agentId, authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    // Create child subtask
    await app.store.append('child1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 'child1', title: 'Child Subtask', intent: '',
        priority: 'normal' as const, agentId, parentTaskId: 'parent1',
        authorActorId: DEFAULT_AGENT_ACTOR_ID
      }
    }])

    const { lastFrame, unmount } = render(<MainTui app={app} />)
    await wait(200)

    const frame = lastFrame()!
    // Parent should appear
    expect(frame).toMatch(/Parent Task/)
    // Child should appear with tree connector
    expect(frame).toMatch(/Child Subtask/)
    // Tree connector should be present (└─ or ├─)
    expect(frame).toMatch(/[└├]─/)

    unmount()
    rmSync(dir, { recursive: true, force: true })
  })

  test('shows agent badge in task list', async () => {
    const { app, dir } = await createTestApp()
    const agentId = app.runtimeManager.defaultAgentId

    await app.store.append('t1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 't1', title: 'Test task', intent: '',
        priority: 'foreground' as const, agentId, authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    const { lastFrame, unmount } = render(<MainTui app={app} />)
    await wait(200)

    const frame = lastFrame()!
    // Agent badge (without agent_ prefix) should be visible
    const agentLabel = agentId.replace(/^agent_/, '')
    expect(frame).toContain(`[${agentLabel}]`)

    unmount()
    rmSync(dir, { recursive: true, force: true })
  })

  test('displays status label for tasks', async () => {
    const { app, dir } = await createTestApp()
    const agentId = app.runtimeManager.defaultAgentId

    await app.store.append('t1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 't1', title: 'Open task', intent: '',
        priority: 'foreground' as const, agentId, authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    const { lastFrame, unmount } = render(<MainTui app={app} />)
    await wait(200)

    const frame = lastFrame()!
    // Should show status label
    expect(frame).toMatch(/OPEN/)

    unmount()
    rmSync(dir, { recursive: true, force: true })
  })

  test('shows keyboard hints in task list and status bar', async () => {
    const { app, dir } = await createTestApp()
    const agentId = app.runtimeManager.defaultAgentId

    await app.store.append('t1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 't1', title: 'Any task', intent: '',
        priority: 'foreground' as const, agentId, authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    const { lastFrame, unmount } = render(<MainTui app={app} />)
    await wait(200)

    const frame = lastFrame()!
    // Task list should show shortcut hints
    expect(frame).toMatch(/ESC/)
    // Status bar should show hints
    expect(frame).toMatch(/Tab/)

    unmount()
    rmSync(dir, { recursive: true, force: true })
  })

  test('renders multiple tasks in tree order with child under parent', async () => {
    const { app, dir } = await createTestApp()
    const agentId = app.runtimeManager.defaultAgentId

    // Create parent
    await app.store.append('p1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 'p1', title: 'Parent Alpha', intent: '',
        priority: 'foreground' as const, agentId, authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    // Create another root task
    await app.store.append('r2', [{
      type: 'TaskCreated',
      payload: {
        taskId: 'r2', title: 'Root Beta', intent: '',
        priority: 'normal' as const, agentId, authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    // Create child of p1 (should appear between p1 and r2 in tree order)
    await app.store.append('c1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 'c1', title: 'Child of Alpha', intent: '',
        priority: 'normal' as const, agentId, parentTaskId: 'p1',
        authorActorId: DEFAULT_AGENT_ACTOR_ID
      }
    }])

    const { lastFrame, unmount } = render(<MainTui app={app} />)
    await wait(200)

    const frame = lastFrame()!
    // All three tasks should appear
    expect(frame).toContain('Parent Alpha')
    expect(frame).toContain('Child of Alpha')
    expect(frame).toContain('Root Beta')

    // In tree order, Child of Alpha should come after Parent Alpha
    const parentIdx = frame.indexOf('Parent Alpha')
    const childIdx = frame.indexOf('Child of Alpha')
    const root2Idx = frame.indexOf('Root Beta')
    expect(childIdx).toBeGreaterThan(parentIdx)
    expect(root2Idx).toBeGreaterThan(childIdx)

    unmount()
    rmSync(dir, { recursive: true, force: true })
  })

  test('shows UiBus agent_output events in log', async () => {
    const { app, dir } = await createTestApp()

    const { lastFrame, unmount } = render(<MainTui app={app} />)
    await wait(100)

    // Emit an agent output event through the UiBus
    app.uiBus.emit({
      type: 'agent_output',
      payload: {
        taskId: 'test-task',
        agentId: 'agent_test',
        kind: 'error',
        content: 'Something went wrong!'
      }
    })

    await wait(100)

    const frame = lastFrame()!
    // Error output should be displayed with the error prefix
    expect(frame).toContain('Something went wrong!')

    unmount()
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// Unit tests for TUI utilities
// ============================================================================

describe('TUI utils', () => {
  // Import utils synchronously through normal import
  // (functions are tested directly)
  
  test('sortTasksAsTree groups children under parents', async () => {
    const { sortTasksAsTree } = await import('../src/interfaces/tui/utils.js')
    const tasks = makeTasks()
    const sorted = sortTasksAsTree(tasks)
    const ids = sorted.map(t => t.taskId)
    // Root 1, then its children, then Root 2
    expect(ids).toEqual(['r1', 'c1', 'gc1', 'c2', 'r2'])
  })

  test('computeTaskDepths computes correct depths', async () => {
    const { computeTaskDepths } = await import('../src/interfaces/tui/utils.js')
    const tasks = makeTasks()
    const depths = computeTaskDepths(tasks)
    expect(depths.get('r1')).toBe(0)
    expect(depths.get('r2')).toBe(0)
    expect(depths.get('c1')).toBe(1)
    expect(depths.get('c2')).toBe(1)
    expect(depths.get('gc1')).toBe(2)
  })

  test('buildBreadcrumb returns trail from root to focused', async () => {
    const { buildBreadcrumb } = await import('../src/interfaces/tui/utils.js')
    const tasks = makeTasks()
    const trail = buildBreadcrumb(tasks, 'gc1')
    expect(trail).toEqual(['Root 1', 'Child 1', 'Grandchild'])
  })

  test('buildBreadcrumb returns empty for null focus', async () => {
    const { buildBreadcrumb } = await import('../src/interfaces/tui/utils.js')
    expect(buildBreadcrumb(makeTasks(), null)).toEqual([])
  })

  test('getChildStatusSummary summarizes child statuses', async () => {
    const { getChildStatusSummary } = await import('../src/interfaces/tui/utils.js')
    const tasks = makeTasks()
    tasks[0].childTaskIds = ['c1', 'c2']
    const summary = getChildStatusSummary(tasks[0], tasks)
    expect(summary).toContain('done')
    expect(summary).toContain('running')
  })

  test('getChildStatusSummary returns empty for no children', async () => {
    const { getChildStatusSummary } = await import('../src/interfaces/tui/utils.js')
    const tasks = makeTasks()
    expect(getChildStatusSummary(tasks[1], tasks)).toBe('')
  })

  test('getTreePrefix returns empty for root tasks', async () => {
    const { getTreePrefix } = await import('../src/interfaces/tui/utils.js')
    const tasks = makeTasks()
    expect(getTreePrefix(tasks[0], tasks, 0)).toBe('')
  })

  test('getTreePrefix returns connector for subtasks', async () => {
    const { getTreePrefix } = await import('../src/interfaces/tui/utils.js')
    const tasks = makeTasks()
    const prefix = getTreePrefix(tasks[2], tasks, 1)
    // Should contain either ├─ or └─
    expect(prefix).toMatch(/[├└]─/)
  })

  test('getStatusLabel returns correct labels', async () => {
    const { getStatusLabel } = await import('../src/interfaces/tui/utils.js')
    expect(getStatusLabel('in_progress')).toBe('RUNNING')
    expect(getStatusLabel('awaiting_user')).toBe('WAITING')
    expect(getStatusLabel('done')).toBe('DONE')
  })
})
