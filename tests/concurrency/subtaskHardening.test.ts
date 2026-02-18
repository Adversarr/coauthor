/**
 * Tests for subtask tool hardening:
 * - RD-001: Catch-up + timeout for subtask wait
 * - RD-004: Removed implicit RuntimeManager.start()
 * - PR-002: Cycle detection in computeDepth
 */

import { describe, expect, test, vi } from 'vitest'
import { InMemoryEventStore } from '../helpers/inMemoryEventStore.js'
import { TaskService } from '../../src/application/services/taskService.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const setup = () => {
  const store = new InMemoryEventStore()
  const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
  return { store, taskService }
}

// ---------------------------------------------------------------------------
// State machine: subtask-relevant transitions
// ---------------------------------------------------------------------------

describe('Subtask hardening — state machine guards', () => {
  test('TaskInstructionAdded is blocked on canceled task (CC-004)', async () => {
    const { store, taskService } = setup()
    const { taskId } = await taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })
    await taskService.cancelTask(taskId)

    await expect(taskService.addInstruction(taskId, 'hello')).rejects.toThrow(/Invalid transition/)
  })

  test('TaskInstructionAdded is blocked on paused task (CC-004)', async () => {
    const { store, taskService } = setup()
    const { taskId } = await taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })

    // Move to in_progress then pause
    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } }
    ])
    await taskService.pauseTask(taskId)

    await expect(taskService.addInstruction(taskId, 'hello')).rejects.toThrow(/Invalid transition/)
  })

  test('TaskStarted is blocked on canceled task (RD-003)', async () => {
    const { store, taskService } = setup()
    const { taskId } = await taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })
    await taskService.cancelTask(taskId)

    // Attempting to start a canceled task should be blocked by canTransition
    const task = await taskService.getTask(taskId)
    expect(taskService.canTransition(task!.status, 'TaskStarted')).toBe(false)
  })

  test('TaskStarted is blocked on failed task (RD-003)', async () => {
    const { store, taskService } = setup()
    const { taskId } = await taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })

    // Move to in_progress then fail
    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } },
      { type: 'TaskFailed', payload: { taskId, reason: 'oops', authorActorId: DEFAULT_AGENT_ACTOR_ID } }
    ])

    const task = await taskService.getTask(taskId)
    expect(taskService.canTransition(task!.status, 'TaskStarted')).toBe(false)
  })

  test('TaskFailed is allowed from paused (CC-003)', async () => {
    const { store, taskService } = setup()
    const { taskId } = await taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })

    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } }
    ])
    await taskService.pauseTask(taskId)

    const task = await taskService.getTask(taskId)
    expect(taskService.canTransition(task!.status, 'TaskFailed')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Reducer: TaskInstructionAdded state transitions
// ---------------------------------------------------------------------------

describe('Subtask hardening — reducer for TaskInstructionAdded', () => {
  test('open → in_progress on instruction', async () => {
    const { taskService } = setup()
    const { taskId } = await taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })

    await taskService.addInstruction(taskId, 'go')
    const task = await taskService.getTask(taskId)
    expect(task!.status).toBe('in_progress')
  })

  test('in_progress stays in_progress on instruction', async () => {
    const { store, taskService } = setup()
    const { taskId } = await taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })

    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } }
    ])
    await taskService.addInstruction(taskId, 'more work')
    const task = await taskService.getTask(taskId)
    expect(task!.status).toBe('in_progress')
  })

  test('awaiting_user stays awaiting_user on instruction (CC-004)', async () => {
    const { store, taskService } = setup()
    const { taskId } = await taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })

    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } },
      {
        type: 'UserInteractionRequested',
        payload: {
          taskId, interactionId: 'ui_x', kind: 'Confirm', purpose: 'test',
          display: { title: 'OK?' }, options: [], validation: {},
          authorActorId: DEFAULT_AGENT_ACTOR_ID
        }
      }
    ])

    await taskService.addInstruction(taskId, 'override attempt')
    const task = await taskService.getTask(taskId)
    expect(task!.status).toBe('awaiting_user')
  })

  test('done → in_progress on instruction (restart)', async () => {
    const { store, taskService } = setup()
    const { taskId } = await taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })

    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } },
      { type: 'TaskCompleted', payload: { taskId, summary: 'done', authorActorId: DEFAULT_AGENT_ACTOR_ID } }
    ])

    await taskService.addInstruction(taskId, 'do more')
    const task = await taskService.getTask(taskId)
    expect(task!.status).toBe('in_progress')
  })

  test('failed → in_progress on instruction (retry)', async () => {
    const { store, taskService } = setup()
    const { taskId } = await taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })

    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } },
      { type: 'TaskFailed', payload: { taskId, reason: 'error', authorActorId: DEFAULT_AGENT_ACTOR_ID } }
    ])

    await taskService.addInstruction(taskId, 'retry')
    const task = await taskService.getTask(taskId)
    expect(task!.status).toBe('in_progress')
  })
})
