/**
 * Tests for localhost authentication bypass.
 *
 * Verifies that both HTTP API and WebSocket connections from localhost
 * are accepted without authentication tokens. This is safe because
 * the server only binds to 127.0.0.1 by default.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { createApp, type App } from '../../src/interfaces/app/createApp.js'
import { SeedServer } from '../../src/infrastructure/servers/server.js'

const RUN_SERVER_INTEGRATION = process.env.SEED_RUN_SERVER_INTEGRATION === '1'
const describeLocalhostAuth = RUN_SERVER_INTEGRATION ? describe : describe.skip

describeLocalhostAuth('Localhost Auth Bypass', () => {
  let tmpDir: string
  let app: App
  let server: SeedServer
  const TOKEN = 'localhost-bypass-test-token'

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'seed-localhost-'))
    app = await createApp({ baseDir: tmpDir })
    server = new SeedServer(app, { authToken: TOKEN, port: 0 })
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
    await app.dispose()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function url(path: string): string {
    const addr = server.address!
    return `http://${addr.host}:${addr.port}${path}`
  }

  function wsUrl(query = ''): string {
    const addr = server.address!
    return `ws://${addr.host}:${addr.port}/ws${query}`
  }

  // ── HTTP ──

  describe('HTTP API', () => {
    it('allows unauthenticated requests from localhost', async () => {
      const res = await fetch(url('/api/tasks'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { tasks: unknown[] }
      expect(body.tasks).toBeInstanceOf(Array)
    })

    it('allows unauthenticated POST from localhost', async () => {
      const res = await fetch(url('/api/tasks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Localhost test task' }),
      })
      expect(res.status).toBe(201)
    })

    it('still accepts explicitly authenticated requests', async () => {
      const res = await fetch(url('/api/tasks'), {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      expect(res.status).toBe(200)
    })
  })

  // ── WebSocket ──

  describe('WebSocket', () => {
    it('allows connection without token from localhost', async () => {
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(wsUrl())
        socket.on('open', () => resolve(socket))
        socket.on('error', reject)
      })
      expect(ws.readyState).toBe(WebSocket.OPEN)
      ws.close()
    })

    it('allows connection with wrong token from localhost', async () => {
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(wsUrl('?token=bad-token'))
        socket.on('open', () => resolve(socket))
        socket.on('error', reject)
      })
      expect(ws.readyState).toBe(WebSocket.OPEN)
      ws.close()
    })

    it('connected unauthenticated client can subscribe and receive events', async () => {
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(wsUrl())
        socket.on('open', () => resolve(socket))
        socket.on('error', reject)
      })

      // Subscribe to events
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'] }))
      const ack = await new Promise<unknown>((resolve) => {
        ws.once('message', (data) => resolve(JSON.parse(String(data))))
      })
      expect(ack).toMatchObject({ type: 'subscribed', channels: ['events'] })

      // Create a task (unauthenticated, enabled by localhost bypass)
      const eventP = new Promise<unknown>((resolve) => {
        ws.once('message', (data) => resolve(JSON.parse(String(data))))
      })

      const createRes = await fetch(url('/api/tasks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'WS Bypass Test' }),
      })
      expect(createRes.status).toBe(201)

      // Should receive the event without any auth
      const event = (await eventP) as { type: string; data: { type: string } }
      expect(event.type).toBe('event')
      expect(event.data.type).toBe('TaskCreated')

      ws.close()
    })
  })
})
