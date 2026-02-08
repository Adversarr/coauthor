import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'
import { createAuditLog } from '../src/infra/jsonlAuditLog.js'
import { AuditService } from '../src/application/auditService.js'
import type { AuditLogEntry } from '../src/domain/ports/auditLog.js'

describe('Audit System', () => {
  let baseDir: string
  let auditPath: string

  beforeEach(() => {
    baseDir = join(tmpdir(), `coauthor-audit-${nanoid()}`)
    mkdirSync(baseDir, { recursive: true })
    auditPath = join(baseDir, 'audit.jsonl')
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('should append and read audit entries', async () => {
    const log = await createAuditLog(auditPath)
    const service = new AuditService(log)

    const entry1: AuditLogEntry = {
      type: 'ToolCallRequested',
      payload: {
        toolCallId: '1',
        toolName: 'test',
        authorActorId: 'user',
        taskId: 't1',
        input: { foo: 'bar' },
        timestamp: Date.now()
      }
    }

    const entry2: AuditLogEntry = {
      type: 'ToolCallCompleted',
      payload: {
        toolCallId: '1',
        toolName: 'test',
        authorActorId: 'user',
        taskId: 't1',
        output: { result: 'ok' },
        isError: false,
        durationMs: 10,
        timestamp: Date.now() + 10
      }
    }

    await log.append(entry1)
    await log.append(entry2)

    // Test readAll
    const all = await log.readAll()
    expect(all).toHaveLength(2)
    expect(all[0].id).toBe(1)
    expect(all[1].id).toBe(2)

    // Test readByTask
    const taskEntries = await log.readByTask('t1')
    expect(taskEntries).toHaveLength(2)
    const emptyEntries = await log.readByTask('t2')
    expect(emptyEntries).toHaveLength(0)

    // Test AuditService
    const recent = await service.getRecentEntries('t1')
    expect(recent).toHaveLength(2)
    expect(recent[0].id).toBe(2) // Sorted descending
    expect(recent[1].id).toBe(1)
  })

  it('should observe new entries', async () => {
    const log = await createAuditLog(auditPath)
    const service = new AuditService(log)

    const entry1: AuditLogEntry = {
      type: 'ToolCallRequested',
      payload: {
        toolCallId: '1',
        toolName: 'test',
        authorActorId: 'user',
        taskId: 't1',
        input: { foo: 'bar' },
        timestamp: Date.now()
      }
    }

    await log.append(entry1)

    const observable = await service.observeEntries('t1')
    const received: any[] = []

    const sub = observable.subscribe(e => received.push(e))

    // Should receive initial history
    expect(received).toHaveLength(1)
    expect(received[0].payload.toolCallId).toBe('1')

    // Append new entry
    const entry2: AuditLogEntry = {
      type: 'ToolCallCompleted',
      payload: {
        toolCallId: '1',
        toolName: 'test',
        authorActorId: 'user',
        taskId: 't1', // Same task
        output: { result: 'ok' },
        isError: false,
        durationMs: 10,
        timestamp: Date.now() + 10
      }
    }
    await log.append(entry2)

    // Append entry for different task
    const entry3: AuditLogEntry = {
        type: 'ToolCallRequested',
        payload: {
          toolCallId: '2',
          toolName: 'other',
          authorActorId: 'user',
          taskId: 't2', // Different task
          input: {},
          timestamp: Date.now() + 20
        }
      }
      await log.append(entry3)

    // Allow observable to fire
    await new Promise(resolve => setTimeout(resolve, 10))

    sub.unsubscribe()

    // Should have received entry2 but NOT entry3
    expect(received).toHaveLength(2)
    expect(received[1].payload.toolCallId).toBe('1')
    expect(received[1].type).toBe('ToolCallCompleted')
  })
})
