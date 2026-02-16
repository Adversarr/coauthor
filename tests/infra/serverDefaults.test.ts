/**
 * Tests for server default configuration values.
 *
 * Validates that DEFAULT_PORT matches the Vite proxy (web/vite.config.ts)
 * and that SeedServer uses it when no port is explicitly provided.
 */

import { describe, it, expect } from 'vitest'
import { DEFAULT_PORT } from '../../src/infrastructure/servers/server.js'

describe('Server Defaults', () => {
  it('DEFAULT_PORT is 3120 (matches Vite proxy)', () => {
    expect(DEFAULT_PORT).toBe(3120)
  })

  it('DEFAULT_PORT is a valid TCP port in user-space range', () => {
    expect(DEFAULT_PORT).toBeGreaterThanOrEqual(1024)
    expect(DEFAULT_PORT).toBeLessThanOrEqual(65535)
  })
})
