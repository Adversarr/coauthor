/**
 * Tests for SA-001 (risky-tool approval binding to toolCallId) and
 * SA-002 (UIP response validation against pending interaction).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, afterEach } from 'vitest'
import { InMemoryEventStore } from '../helpers/inMemoryEventStore.js'
import { InteractionService } from '../../src/application/services/interactionService.js'
import { TaskService } from '../../src/application/services/taskService.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'
import { buildConfirmInteraction } from '../../src/agents/display/displayBuilder.js'

// ---------------------------------------------------------------------------
// SA-002 — UIP response validation
// ---------------------------------------------------------------------------

describe('SA-002: UIP response validation', () => {
  const createSetup = () => {
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const interactionService = new InteractionService(store, DEFAULT_USER_ACTOR_ID)
    return { store, taskService, interactionService }
  }

  test('rejects response when no pending interaction exists', async () => {
    const { store, taskService, interactionService } = createSetup()

    const { taskId } = await taskService.createTask({ title: 'Test', agentId: DEFAULT_AGENT_ACTOR_ID })

    await expect(
      interactionService.respondToInteraction(taskId, 'ui_nonexistent', { selectedOptionId: 'approve' })
    ).rejects.toThrow(/No pending interaction/)
  })

  test('rejects response with stale/wrong interactionId', async () => {
    const { store, taskService, interactionService } = createSetup()

    const { taskId } = await taskService.createTask({ title: 'Test', agentId: DEFAULT_AGENT_ACTOR_ID })

    // Start the task and create a UIP
    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } },
      {
        type: 'UserInteractionRequested',
        payload: {
          taskId,
          interactionId: 'ui_real',
          kind: 'Confirm',
          purpose: 'test',
          display: { title: 'Test?' },
          options: [],
          validation: {},
          authorActorId: DEFAULT_AGENT_ACTOR_ID
        }
      }
    ])

    // Respond with a DIFFERENT interaction ID
    await expect(
      interactionService.respondToInteraction(taskId, 'ui_stale', { selectedOptionId: 'approve' })
    ).rejects.toThrow(/Stale\/duplicate response rejected/)
  })

  test('accepts response with correct pending interactionId', async () => {
    const { store, taskService, interactionService } = createSetup()

    const { taskId } = await taskService.createTask({ title: 'Test', agentId: DEFAULT_AGENT_ACTOR_ID })

    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } },
      {
        type: 'UserInteractionRequested',
        payload: {
          taskId,
          interactionId: 'ui_correct',
          kind: 'Confirm',
          purpose: 'test',
          display: { title: 'OK?' },
          options: [],
          validation: {},
          authorActorId: DEFAULT_AGENT_ACTOR_ID
        }
      }
    ])

    // Should succeed
    await expect(
      interactionService.respondToInteraction(taskId, 'ui_correct', { selectedOptionId: 'approve' })
    ).resolves.toBeUndefined()
  })

  test('rejects duplicate response (already answered)', async () => {
    const { store, taskService, interactionService } = createSetup()

    const { taskId } = await taskService.createTask({ title: 'Test', agentId: DEFAULT_AGENT_ACTOR_ID })

    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } },
      {
        type: 'UserInteractionRequested',
        payload: {
          taskId, interactionId: 'ui_once', kind: 'Confirm', purpose: 'test',
          display: { title: 'Confirm?' }, options: [], validation: {},
          authorActorId: DEFAULT_AGENT_ACTOR_ID
        }
      }
    ])

    // First response succeeds
    await interactionService.respondToInteraction(taskId, 'ui_once', { selectedOptionId: 'approve' })

    // Second response to the same interaction fails (no pending interaction anymore)
    await expect(
      interactionService.respondToInteraction(taskId, 'ui_once', { selectedOptionId: 'approve' })
    ).rejects.toThrow(/No pending interaction/)
  })
})

// ---------------------------------------------------------------------------
// SA-001 — Approval binding to toolCallId
// ---------------------------------------------------------------------------

describe('SA-001: Approval binding via display metadata', () => {
  test('buildConfirmInteraction binds toolCallId in display metadata', () => {
    const toolCall = {
      toolCallId: 'call_abc123',
      toolName: 'runCommand',
      arguments: { command: 'rm -rf /' }
    }

    const interaction = buildConfirmInteraction(toolCall)

    expect(interaction.kind).toBe('Confirm')
    expect(interaction.purpose).toBe('confirm_risky_action')
    expect(interaction.display.metadata).toBeDefined()
    expect(interaction.display.metadata!.toolCallId).toBe('call_abc123')
    expect(interaction.options).toHaveLength(2)
    expect(interaction.options.some(o => o.id === 'approve')).toBe(true)
    expect(interaction.options.some(o => o.id === 'reject')).toBe(true)
  })

  test('each confirmation gets a unique interactionId', () => {
    const toolCall = {
      toolCallId: 'call_same',
      toolName: 'test_tool',
      arguments: {}
    }

    const a = buildConfirmInteraction(toolCall)
    const b = buildConfirmInteraction(toolCall)

    expect(a.interactionId).not.toBe(b.interactionId)
  })
})
