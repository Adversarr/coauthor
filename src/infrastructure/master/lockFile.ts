/**
 * Master lock file — enables multiple TUI/Web clients to discover a running master process.
 *
 * Lock file path: <baseDir>/.seed/server.lock
 * Content: JSON with { pid, port, token, startedAt }
 *
 * Design:
 * - Atomic write (write tmp then rename) to prevent partial reads.
 * - PID liveness check via `process.kill(pid, 0)`.
 * - Stale lock auto-cleanup when PID is dead.
 */

import { writeFileSync, readFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { z } from 'zod'

// ============================================================================
// Schema
// ============================================================================

export const LockFileDataSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  token: z.string().min(1),
  startedAt: z.string(),
})

export type LockFileData = z.infer<typeof LockFileDataSchema>

// ============================================================================
// Lock File Operations
// ============================================================================

export function lockFilePath(baseDir: string): string {
  return join(baseDir, '.seed', 'server.lock')
}

export function writeLockFile(path: string, data: LockFileData): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = path + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmpPath, path)
}

export function readLockFile(path: string): LockFileData | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    return LockFileDataSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export function removeLockFile(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // Ignore ENOENT
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
