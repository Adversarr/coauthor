import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { PatchService } from '../src/application/patchService.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

function rev(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

describe('Patch baseRevision concurrency control', () => {
  test('rejects apply when baseRevision mismatches current file revision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const repoDir = join(dir, 'repo')
    const eventsPath = join(dir, 'events.jsonl')
    const projectionsPath = join(dir, 'projections.jsonl')
    const store = new JsonlEventStore({ eventsPath, projectionsPath })
    store.ensureSchema()

    const filePath = join(repoDir, 'doc.tex')
    mkdirSync(repoDir, { recursive: true })
    writeFileSync(filePath, 'hello\n', 'utf8')

    const svc = new PatchService(store, repoDir, DEFAULT_USER_ACTOR_ID)
    const taskId = 't1'
    const patchText = ['--- a/doc.tex', '+++ b/doc.tex', '@@ -1,1 +1,1 @@', '-hello', '+HELLO', ''].join('\n')
    const { proposalId } = svc.proposePatch(taskId, 'doc.tex', patchText)

    writeFileSync(filePath, 'bonjour\n', 'utf8')

    await expect(svc.acceptAndApplyPatch(taskId, proposalId)).rejects.toThrow(/baseRevision 不匹配/)
    expect(readFileSync(filePath, 'utf8')).toBe('bonjour\n')

    const events = store.readStream(taskId, 1)
    expect(events.some((e) => e.type === 'PatchAccepted')).toBe(false)
    expect(events.some((e) => e.type === 'PatchApplied')).toBe(false)
    expect(events.some((e) => e.type === 'PatchRejected')).toBe(true)
    expect(events.some((e) => e.type === 'TaskNeedsRebase')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('writes newRevision on successful apply', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const repoDir = join(dir, 'repo')
    const eventsPath = join(dir, 'events.jsonl')
    const projectionsPath = join(dir, 'projections.jsonl')
    const store = new JsonlEventStore({ eventsPath, projectionsPath })
    store.ensureSchema()

    const filePath = join(repoDir, 'doc.tex')
    mkdirSync(repoDir, { recursive: true })
    writeFileSync(filePath, 'hello\n', 'utf8')

    const svc = new PatchService(store, repoDir, DEFAULT_USER_ACTOR_ID)
    const taskId = 't1'
    const patchText = ['--- a/doc.tex', '+++ b/doc.tex', '@@ -1,1 +1,1 @@', '-hello', '+HELLO', ''].join('\n')
    const { proposalId } = svc.proposePatch(taskId, 'doc.tex', patchText)

    const res = await svc.acceptAndApplyPatch(taskId, proposalId)
    expect(res.targetPath).toBe('doc.tex')
    expect(readFileSync(filePath, 'utf8')).toBe('HELLO\n')

    const applied = store.readStream(taskId, 1).find((e) => e.type === 'PatchApplied')
    expect(applied).toBeTruthy()
    if (applied?.type === 'PatchApplied') {
      expect(applied.payload.newRevision).toBe(rev('HELLO\n'))
    }

    rmSync(dir, { recursive: true, force: true })
  })
})
