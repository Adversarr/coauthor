/**
 * Integration test: HTTP + WebSocket server end-to-end.
 *
 * Tests: create task via HTTP → receive TaskCreated via WebSocket.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { createApp, type App } from '../../src/interfaces/app/createApp.js'
import { SeedServer } from '../../src/infrastructure/servers/server.js'

const RUN_SERVER_INTEGRATION = process.env.SEED_RUN_SERVER_INTEGRATION === '1'
const describeServerIntegration = RUN_SERVER_INTEGRATION ? describe : describe.skip

describeServerIntegration('Server Integration', () => {
  let tmpDir: string
  let app: App
  let server: SeedServer
  const TOKEN = 'integration-test-token'

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'seed-integ-'))
    app = await createApp({ baseDir: tmpDir })
    // Use an ephemeral port to avoid collisions with dev servers on 3120.
    server = new SeedServer(app, { authToken: TOKEN, port: 0 })
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function url(path: string): string {
    const addr = server.address!
    return `http://${addr.host}:${addr.port}${path}`
  }

  function wsUrl(): string {
    const addr = server.address!
    return `ws://${addr.host}:${addr.port}/ws?token=${TOKEN}`
  }

  it('serves health endpoint', async () => {
    const res = await fetch(url('/api/health'))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ok')
  })

  it('creates task and receives event via WebSocket', async () => {
    // Connect WS and subscribe
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(wsUrl())
      socket.on('open', () => resolve(socket))
      socket.on('error', reject)
    })

    // Subscribe to events channel
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'] }))
    const ack = await new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(String(data))))
    })
    expect(ack).toEqual({ type: 'subscribed', channels: ['events'] })

    // Register WS listener BEFORE creating task to avoid race condition
    const eventP = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(String(data))))
    })

    // Create task via HTTP
    const createRes = await fetch(url('/api/tasks'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ title: 'Integration Test Task' }),
    })
    expect(createRes.status).toBe(201)
    const { taskId } = await createRes.json() as { taskId: string }

    // Receive TaskCreated event via WS
    const event = await eventP
    expect(event).toMatchObject({
      type: 'event',
      data: {
        type: 'TaskCreated',
        streamId: taskId,
        payload: { title: 'Integration Test Task' },
      },
    })

    ws.close()
  })

  it('lists tasks via HTTP', async () => {
    // Create a task
    await fetch(url('/api/tasks'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ title: 'HTTP List Test' }),
    })

    // List tasks
    const res = await fetch(url('/api/tasks'), {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { tasks: { tasks: unknown[] } }
    expect(body.tasks).toBeDefined()
  })

  it('server reports address correctly', () => {
    expect(server.address).toBeDefined()
    expect(server.address!.port).toBeGreaterThan(0)
    expect(server.address!.host).toBe('127.0.0.1')
  })

  it('server isRunning reflects state', async () => {
    expect(server.isRunning).toBe(true)
    await server.stop()
    expect(server.isRunning).toBe(false)
  })
})
