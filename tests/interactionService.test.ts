import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'
import { JsonlEventStore } from '../src/infrastructure/persistence/jsonlEventStore.js'
import { InteractionService } from '../src/application/services/interactionService.js'

describe('InteractionService', () => {
  let baseDir: string
  let eventsPath: string

  beforeEach(() => {
    baseDir = join(tmpdir(), `seed-interaction-${nanoid()}`)
    mkdirSync(baseDir, { recursive: true })
    eventsPath = join(baseDir, 'events.jsonl')
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('should request and respond to interactions', async () => {
    const store = new JsonlEventStore({ eventsPath })
    await store.ensureSchema()
    const service = new InteractionService(store)
    const taskId = 't1'

    // Request
    const { interactionId } = await service.requestInteraction(taskId, {
      kind: 'Confirm',
      purpose: 'confirm_risky_action',
      display: { title: 'Confirm' }
    })

    // Get Pending
    const pending = await service.getPendingInteraction(taskId)
    expect(pending).not.toBeNull()
    expect(pending?.interactionId).toBe(interactionId)

    // Respond
    await service.respondToInteraction(taskId, interactionId, { selectedOptionId: 'ok' })

    // Get Pending again (should be null)
    const pendingAfter = await service.getPendingInteraction(taskId)
    expect(pendingAfter).toBeNull()

    // Get Response
    const response = await service.getInteractionResponse(taskId, interactionId)
    expect(response).not.toBeNull()
    expect(response?.selectedOptionId).toBe('ok')
  })

  it('should wait for response', async () => {
    const store = new JsonlEventStore({ eventsPath })
    await store.ensureSchema()
    const service = new InteractionService(store)
    const taskId = 't1'
    const { interactionId } = await service.requestInteraction(taskId, {
      kind: 'Input',
      purpose: 'request_info',
      display: { title: 'Input' }
    })

    // Simulate async response
    setTimeout(async () => {
      await service.respondToInteraction(taskId, interactionId, { inputValue: 'hello' })
    }, 50)

    const response = await service.waitForResponse(taskId, interactionId, { pollIntervalMs: 10 })
    expect(response).not.toBeNull()
    expect(response?.inputValue).toBe('hello')
  })
})
