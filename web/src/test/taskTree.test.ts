/**
 * TaskTree component tests.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskStore } from '@/stores/taskStore'
import { useStreamStore } from '@/stores/streamStore'
import type { TaskView } from '@/types'

function makeTask(overrides: Partial<TaskView>): TaskView {
  return {
    taskId: 'task-1',
    title: 'Test Task',
    intent: '',
    createdBy: 'user',
    agentId: 'agent-1',
    priority: 'foreground',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('TaskTree data logic', () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: [], loading: false, error: null })
    useStreamStore.setState({ streams: {} })
  })

  it('stores support parent-child task relationships', () => {
    const parent = makeTask({ taskId: 'p1', title: 'Parent' })
    const child = makeTask({ taskId: 'c1', title: 'Child', parentTaskId: 'p1' })
    useTaskStore.setState({ tasks: [parent, child] })
    const tasks = useTaskStore.getState().tasks
    expect(tasks).toHaveLength(2)
    expect(tasks.find(t => t.taskId === 'c1')?.parentTaskId).toBe('p1')
  })

  it('child tasks can be filtered by parentTaskId', () => {
    const parent = makeTask({ taskId: 'p1', title: 'Parent' })
    const child1 = makeTask({ taskId: 'c1', parentTaskId: 'p1' })
    const child2 = makeTask({ taskId: 'c2', parentTaskId: 'p1' })
    const unrelated = makeTask({ taskId: 'u1' })
    useTaskStore.setState({ tasks: [parent, child1, child2, unrelated] })
    const children = useTaskStore.getState().tasks.filter(t => t.parentTaskId === 'p1')
    expect(children).toHaveLength(2)
  })

  it('stream store TaskStream shape has completed flag', () => {
    useStreamStore.getState().handleUiEvent({
      type: 'stream_delta',
      payload: { taskId: 't1', agentId: 'a1', kind: 'text', content: 'hello' },
    })
    const stream = useStreamStore.getState().streams['t1']
    expect(stream).toBeDefined()
    if (!stream) throw new Error('expected stream to exist')
    expect(stream.completed).toBe(false)
    expect(stream.chunks.length).toBeGreaterThanOrEqual(1)
  })
})
