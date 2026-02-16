/**
 * Tests for master/client discovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverMaster } from '../../src/infrastructure/master/discovery.js'
import { writeLockFile, lockFilePath } from '../../src/infrastructure/master/lockFile.js'

describe('Master Discovery', () => {
  let tmpDir: string
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'seed-disc-test-'))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns master when no lock file exists', async () => {
    const result = await discoverMaster(tmpDir)
    expect(result).toEqual({ mode: 'master' })
  })

  it('returns master when lock file has dead PID', async () => {
    writeLockFile(lockFilePath(tmpDir), {
      pid: 99999999, // Dead PID
      port: 3000,
      token: 'tok',
      startedAt: new Date().toISOString(),
    })
    const result = await discoverMaster(tmpDir)
    expect(result).toEqual({ mode: 'master' })
  })

  it('returns client when lock file points to live server', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })) as typeof fetch

    writeLockFile(lockFilePath(tmpDir), {
      pid: process.pid,
      port: 12345,
      token: 'my-token',
      startedAt: new Date().toISOString(),
    })

    const result = await discoverMaster(tmpDir)
    expect(result).toEqual({ mode: 'client', port: 12345, token: 'my-token' })
  })

  it('returns master when health check times out', async () => {
    globalThis.fetch = (async () => {
      throw new DOMException('aborted', 'AbortError')
    }) as typeof fetch

    writeLockFile(lockFilePath(tmpDir), {
      pid: process.pid,
      port: 12345,
      token: 'tok',
      startedAt: new Date().toISOString(),
    })

    const result = await discoverMaster(tmpDir)
    expect(result).toEqual({ mode: 'master' })
  })

  it('returns master when health check returns non-200', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch

    writeLockFile(lockFilePath(tmpDir), {
      pid: process.pid,
      port: 12345,
      token: 'tok',
      startedAt: new Date().toISOString(),
    })

    const result = await discoverMaster(tmpDir)
    expect(result).toEqual({ mode: 'master' })
  })
})
