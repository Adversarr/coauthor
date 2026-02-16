/**
 * Tests for master lock file operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  writeLockFile,
  readLockFile,
  removeLockFile,
  isProcessAlive,
  lockFilePath,
  type LockFileData,
} from '../../src/infrastructure/master/lockFile.js'

describe('Lock File', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'seed-lock-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const sampleData: LockFileData = {
    pid: process.pid,
    port: 3456,
    token: 'abc123',
    startedAt: '2025-01-01T00:00:00.000Z',
  }

  it('lockFilePath returns correct path', () => {
    expect(lockFilePath('/home/user/project')).toBe('/home/user/project/.seed/server.lock')
  })

  it('writes and reads lock file', () => {
    const path = join(tmpDir, '.seed', 'server.lock')
    writeLockFile(path, sampleData)
    expect(existsSync(path)).toBe(true)

    const data = readLockFile(path)
    expect(data).toEqual(sampleData)
  })

  it('creates parent directories', () => {
    const path = join(tmpDir, 'deep', 'nested', 'server.lock')
    writeLockFile(path, sampleData)
    expect(existsSync(path)).toBe(true)
  })

  it('returns null for nonexistent file', () => {
    const path = join(tmpDir, 'nonexistent.lock')
    expect(readLockFile(path)).toBeNull()
  })

  it('returns null for malformed file', () => {
    const path = join(tmpDir, 'bad.lock')
    require('node:fs').writeFileSync(path, 'not json')
    expect(readLockFile(path)).toBeNull()
  })

  it('returns null for invalid schema', () => {
    const path = join(tmpDir, 'bad.lock')
    require('node:fs').writeFileSync(path, '{"pid": "not a number"}')
    expect(readLockFile(path)).toBeNull()
  })

  it('removes lock file', () => {
    const path = join(tmpDir, 'server.lock')
    writeLockFile(path, sampleData)
    expect(existsSync(path)).toBe(true)
    removeLockFile(path)
    expect(existsSync(path)).toBe(false)
  })

  it('removeLockFile does not throw for nonexistent file', () => {
    const path = join(tmpDir, 'nonexistent.lock')
    expect(() => removeLockFile(path)).not.toThrow()
  })

  describe('isProcessAlive', () => {
    it('returns true for current process', () => {
      expect(isProcessAlive(process.pid)).toBe(true)
    })

    it('returns false for definitely-dead PID', () => {
      // PID 99999999 is extremely unlikely to exist
      expect(isProcessAlive(99999999)).toBe(false)
    })
  })
})
