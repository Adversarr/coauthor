import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { AuditLogEntry } from '../../src/core/ports/auditLog.js'
import { createApp } from '../../src/interfaces/app/createApp.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'

async function waitForPath(path: string): Promise<void> {
  const maxAttempts = 40
  const delayMs = 10

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw new Error(`Path did not appear in time: ${path}`)
}

async function expectPathToStayMissing(path: string): Promise<void> {
  const checks = 20
  const delayMs = 10

  for (let check = 0; check < checks; check++) {
    await expect(access(path)).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

function createToolCallRequestedEntry(toolCallId: string): AuditLogEntry {
  return {
    type: 'ToolCallRequested',
    payload: {
      toolCallId,
      toolName: 'readFile',
      authorActorId: DEFAULT_AGENT_ACTOR_ID,
      taskId: 'task-for-dispose-test',
      input: { path: 'private:/note.txt' },
      timestamp: Date.now(),
    },
  }
}

describe('createApp lifecycle cleanup', () => {
  test('dispose detaches audit forwarding from ui bus', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'seed-app-dispose-audit-'))
    const app = await createApp({ baseDir })
    const forwardedToolCallIds: string[] = []
    const uiSubscription = app.uiBus.events$.subscribe((event) => {
      if (event.type !== 'audit_entry') return
      forwardedToolCallIds.push(event.payload.payload.toolCallId)
    })

    try {
      await app.auditLog.append(createToolCallRequestedEntry('before-dispose'))
      expect(forwardedToolCallIds).toEqual(['before-dispose'])

      await app.dispose()

      await app.auditLog.append(createToolCallRequestedEntry('after-dispose'))
      expect(forwardedToolCallIds).toEqual(['before-dispose'])
    } finally {
      uiSubscription.unsubscribe()
      await app.dispose()
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  test('dispose stops workspace provisioning subscription', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'seed-app-dispose-workspace-'))
    const app = await createApp({ baseDir })
    const taskStartedEvent = (taskId: string) => ({
      type: 'TaskStarted' as const,
      payload: {
        taskId,
        agentId: DEFAULT_AGENT_ACTOR_ID,
        authorActorId: DEFAULT_AGENT_ACTOR_ID,
      },
    })

    try {
      const beforeDisposeTaskId = 'before-dispose-task'
      const afterDisposeTaskId = 'after-dispose-task'
      const beforeDisposePrivatePath = join(baseDir, 'private', beforeDisposeTaskId)
      const afterDisposePrivatePath = join(baseDir, 'private', afterDisposeTaskId)

      await app.store.append(beforeDisposeTaskId, [taskStartedEvent(beforeDisposeTaskId)])
      await waitForPath(beforeDisposePrivatePath)

      await app.dispose()

      await app.store.append(afterDisposeTaskId, [taskStartedEvent(afterDisposeTaskId)])
      await expectPathToStayMissing(afterDisposePrivatePath)
    } finally {
      await app.dispose()
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  test('dispose is idempotent and stops MCP extension once', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'seed-app-dispose-mcp-'))
    const app = await createApp({ baseDir })
    expect(app.mcpToolExtension).not.toBeNull()
    const stopSpy = vi.spyOn(app.mcpToolExtension!, 'stop')

    try {
      await app.dispose()
      await app.dispose()
      expect(stopSpy).toHaveBeenCalledTimes(1)
    } finally {
      stopSpy.mockRestore()
      await app.dispose()
      await rm(baseDir, { recursive: true, force: true })
    }
  })
})
