/**
 * Tests for WebSocket server: auth, subscribe, broadcast, gap-fill, heartbeat.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import { Subject } from 'rxjs'
import { SeedWsServer, type WsServerDeps } from '../../src/infrastructure/servers/ws/wsServer.js'
import type { StoredEvent } from '../../src/core/events/events.js'
import type { UiEvent } from '../../src/core/ports/uiBus.js'

// ── Helpers ──

function makeEvent(id: number, streamId: string, type = 'TaskCreated'): StoredEvent {
  return {
    id,
    streamId,
    seq: 1,
    type: type as StoredEvent['type'],
    payload: { taskId: streamId, title: 'test', intent: '', agentId: 'agent-1', authorActorId: 'user-1' },
    createdAt: new Date().toISOString(),
  } as StoredEvent
}

function connectWs(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function receiveMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(String(data))))
  })
}

/** Collect exactly `n` messages from a WebSocket. Registers listener once upfront to avoid race. */
function receiveMessages(ws: WebSocket, n: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const msgs: unknown[] = []
    const handler = (data: Buffer | string) => {
      msgs.push(JSON.parse(String(data)))
      if (msgs.length >= n) {
        ws.off('message', handler)
        resolve(msgs)
      }
    }
    ws.on('message', handler)
  })
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Tests ──

const RUN_SERVER_INTEGRATION = process.env.SEED_RUN_SERVER_INTEGRATION === '1'
const describeWsServer = RUN_SERVER_INTEGRATION ? describe : describe.skip

describeWsServer('SeedWsServer', () => {
  const TOKEN = 'test-token-123'
  let events$: Subject<StoredEvent>
  let uiEvents$: Subject<UiEvent>
  let storedEvents: StoredEvent[]
  let httpServer: Server
  let wsServer: SeedWsServer
  let port: number

  beforeEach(async () => {
    events$ = new Subject<StoredEvent>()
    uiEvents$ = new Subject<UiEvent>()
    storedEvents = []

    const deps: WsServerDeps = {
      events$,
      uiEvents$,
      getEventsAfter: async (fromId) => storedEvents.filter((e) => e.id > fromId),
      authToken: TOKEN,
    }

    httpServer = createServer()
    wsServer = new SeedWsServer(deps)
    wsServer.attach(httpServer)

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address()
        port = (addr as { port: number }).port
        resolve()
      })
    })
  })

  afterEach(async () => {
    wsServer.close()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  // ── Auth ──

  it('accepts localhost connection without token (auth bypass)', async () => {
    // Server binds 127.0.0.1 — all test connections are from localhost,
    // so the localhost auth bypass allows connections without any token.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('accepts localhost connection even with wrong token (auth bypass)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('accepts connection with valid token', async () => {
    const ws = await connectWs(port, TOKEN)
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('rejects connection on non-/ws path', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/other?token=${TOKEN}`)
    await new Promise<void>((resolve) => {
      ws.on('error', () => resolve())
      ws.on('close', () => resolve())
    })
    expect(ws.readyState).not.toBe(WebSocket.OPEN)
  })

  // ── Subscribe / Unsubscribe ──

  it('acknowledges subscription', async () => {
    const ws = await connectWs(port, TOKEN)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'] }))
    const msg = await receiveMessage(ws)
    expect(msg).toEqual({ type: 'subscribed', channels: ['events'] })
    ws.close()
  })

  it('attach is idempotent and does not duplicate event broadcasts', async () => {
    wsServer.attach(httpServer)

    const ws = await connectWs(port, TOKEN)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'] }))
    await receiveMessage(ws) // ack

    const received: Array<{ type: string; data?: StoredEvent }> = []
    ws.on('message', (raw) => {
      received.push(JSON.parse(String(raw)))
    })

    events$.next(makeEvent(10, 'task-1'))
    await waitMs(60)

    const eventMessages = received.filter((msg) => msg.type === 'event')
    expect(eventMessages).toHaveLength(1)
    expect(eventMessages[0]!.data?.id).toBe(10)
    ws.close()
  })

  it('accumulates channel subscriptions', async () => {
    const ws = await connectWs(port, TOKEN)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'] }))
    await receiveMessage(ws)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['ui'] }))
    const msg = await receiveMessage(ws)
    expect(msg).toEqual({ type: 'subscribed', channels: expect.arrayContaining(['events', 'ui']) })
    ws.close()
  })

  // ── Event Broadcasting ──

  it('broadcasts domain events to subscribed clients', async () => {
    const ws = await connectWs(port, TOKEN)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'] }))
    await receiveMessage(ws) // ack

    const event = makeEvent(1, 'task-1')
    events$.next(event)

    const msg = await receiveMessage(ws) as { type: string; data: StoredEvent }
    expect(msg.type).toBe('event')
    expect(msg.data.id).toBe(1)
    expect(msg.data.streamId).toBe('task-1')
    ws.close()
  })

  it('does not send events to unsubscribed clients', async () => {
    const ws = await connectWs(port, TOKEN)
    // Don't subscribe to any channel

    events$.next(makeEvent(1, 'task-1'))
    await waitMs(50)

    // No messages should arrive
    let received = false
    ws.once('message', () => { received = true })
    await waitMs(50)
    expect(received).toBe(false)
    ws.close()
  })

  it('broadcasts UI events', async () => {
    const ws = await connectWs(port, TOKEN)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['ui'] }))
    await receiveMessage(ws) // ack

    const uiEvent: UiEvent = { type: 'agent_output', payload: { taskId: 't-1', agentId: 'a-1', kind: 'text', content: 'hello' } }
    uiEvents$.next(uiEvent)

    const msg = await receiveMessage(ws) as { type: string; data: UiEvent }
    expect(msg.type).toBe('ui_event')
    expect(msg.data.payload.content).toBe('hello')
    ws.close()
  })

  it('applies streamId filtering to UI events by payload.taskId', async () => {
    const ws = await connectWs(port, TOKEN)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['ui'], streamId: 'task-1' }))
    await receiveMessage(ws) // ack

    uiEvents$.next({ type: 'stream_delta', payload: { taskId: 'task-2', agentId: 'a-1', kind: 'text', content: 'ignore me' } })
    await waitMs(30)

    uiEvents$.next({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a-1', kind: 'text', content: 'deliver me' } })
    const msg = await receiveMessage(ws) as { type: string; data: UiEvent }

    expect(msg.type).toBe('ui_event')
    expect(msg.data).toMatchObject({
      type: 'stream_delta',
      payload: { taskId: 'task-1', content: 'deliver me' },
    })
    ws.close()
  })

  // ── Stream Filtering ──

  it('filters events by streamId when set', async () => {
    const ws = await connectWs(port, TOKEN)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'], streamId: 'task-2' }))
    await receiveMessage(ws)

    events$.next(makeEvent(1, 'task-1'))
    events$.next(makeEvent(2, 'task-2'))

    const msg = await receiveMessage(ws) as { type: string; data: StoredEvent }
    expect(msg.data.streamId).toBe('task-2')
    ws.close()
  })

  // ── Gap Filling ──

  it('sends missed events on subscribe with lastEventId', async () => {
    storedEvents = [makeEvent(1, 'task-1'), makeEvent(2, 'task-1'), makeEvent(3, 'task-2')]

    const ws = await connectWs(port, TOKEN)
    // Collect ack + 2 gap-fill messages upfront to avoid race
    const allP = receiveMessages(ws, 3)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'], lastEventId: 1 }))
    const all = await allP as Array<{ type: string; data?: StoredEvent }>

    expect(all[0].type).toBe('subscribed')
    const events = all.slice(1) as Array<{ type: string; data: StoredEvent }>
    const ids = events.map(m => m.data.id).sort((a, b) => a - b)
    expect(ids).toEqual([2, 3])
    ws.close()
  })

  it('gap-fill respects streamId filter', async () => {
    storedEvents = [makeEvent(1, 'task-1'), makeEvent(2, 'task-2'), makeEvent(3, 'task-1')]

    const ws = await connectWs(port, TOKEN)
    // Collect ack + 2 gap-fill messages (task-2 is filtered out)
    const allP = receiveMessages(ws, 3)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'], streamId: 'task-1', lastEventId: 0 }))
    const all = await allP as Array<{ type: string; data?: StoredEvent }>

    expect(all[0].type).toBe('subscribed')
    const events = all.slice(1) as Array<{ type: string; data: StoredEvent }>
    const ids = events.map(m => m.data.id).sort((a, b) => a - b)
    expect(ids).toEqual([1, 3])
    for (const m of events) {
      expect(m.data.streamId).toBe('task-1')
    }
    ws.close()
  })

  it('deduplicates when gap-fill and live broadcast overlap on the same event ID', async () => {
    storedEvents = [makeEvent(5, 'task-1')]

    const ws = await connectWs(port, TOKEN)
    const received: Array<{ type: string; data?: StoredEvent }> = []
    ws.on('message', (raw) => {
      received.push(JSON.parse(String(raw)))
    })

    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'], lastEventId: 0 }))
    await waitMs(10)

    // Simulate a live broadcast racing with replay for the same event ID.
    events$.next(makeEvent(5, 'task-1'))
    await waitMs(80)

    const ids = received
      .filter((msg) => msg.type === 'event')
      .map((msg) => msg.data?.id)
      .filter((id): id is number => typeof id === 'number')

    expect(ids.filter((id) => id === 5)).toHaveLength(1)
    ws.close()
  })

  // ── Ping / Pong ──

  it('responds to ping with pong', async () => {
    const ws = await connectWs(port, TOKEN)
    ws.send(JSON.stringify({ type: 'ping' }))
    const msg = await receiveMessage(ws)
    expect(msg).toEqual({ type: 'pong' })
    ws.close()
  })

  // ── Error Handling ──

  it('sends error for malformed messages', async () => {
    const ws = await connectWs(port, TOKEN)
    ws.send('not valid json at all')
    const msg = await receiveMessage(ws) as { type: string; code: string }
    expect(msg.type).toBe('error')
    expect(msg.code).toBe('INVALID_MESSAGE')
    ws.close()
  })

  // ── Multiple Clients ──

  it('broadcasts to multiple subscribed clients', async () => {
    const ws1 = await connectWs(port, TOKEN)
    const ws2 = await connectWs(port, TOKEN)

    ws1.send(JSON.stringify({ type: 'subscribe', channels: ['events'] }))
    ws2.send(JSON.stringify({ type: 'subscribe', channels: ['events'] }))
    await receiveMessage(ws1) // ack
    await receiveMessage(ws2) // ack

    expect(wsServer.connectionCount).toBe(2)

    events$.next(makeEvent(1, 'task-1'))

    const [msg1, msg2] = await Promise.all([receiveMessage(ws1), receiveMessage(ws2)])
    expect((msg1 as { data: StoredEvent }).data.id).toBe(1)
    expect((msg2 as { data: StoredEvent }).data.id).toBe(1)

    ws1.close()
    ws2.close()
  })

  // ── Connection Tracking ──

  it('tracks connection count correctly', async () => {
    expect(wsServer.connectionCount).toBe(0)
    const ws = await connectWs(port, TOKEN)
    expect(wsServer.connectionCount).toBe(1)
    ws.close()
    await waitMs(50)
    expect(wsServer.connectionCount).toBe(0)
  })

  // ── Unsubscribe ──

  it('stops receiving events after unsubscribe', async () => {
    const ws = await connectWs(port, TOKEN)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'] }))
    await receiveMessage(ws) // ack

    ws.send(JSON.stringify({ type: 'unsubscribe', channels: ['events'] }))
    await waitMs(20)

    events$.next(makeEvent(1, 'task-1'))
    await waitMs(50)

    let received = false
    ws.once('message', () => { received = true })
    await waitMs(50)
    expect(received).toBe(false)
    ws.close()
  })

  // ── Stream Filter Clearing (B35) ──

  it('clears stream filter when streamId is explicitly null', async () => {
    const ws = await connectWs(port, TOKEN)

    // Subscribe with streamId filter
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'], streamId: 'task-1' }))
    await receiveMessage(ws) // ack

    // task-2 events should be filtered out
    events$.next(makeEvent(1, 'task-2'))
    await waitMs(50)

    // Now clear the filter by sending streamId: null
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'], streamId: null }))
    await receiveMessage(ws) // ack

    // task-2 events should now be received
    events$.next(makeEvent(2, 'task-2'))
    const msg = await receiveMessage(ws) as { type: string; data: StoredEvent }
    expect(msg.data.streamId).toBe('task-2')
    ws.close()
  })

  it('preserves stream filter when streamId is omitted in re-subscribe', async () => {
    const ws = await connectWs(port, TOKEN)

    // Subscribe with streamId filter
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'], streamId: 'task-1' }))
    await receiveMessage(ws)

    // Re-subscribe without streamId field (should preserve the filter)
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['events'] }))
    await receiveMessage(ws)

    // task-2 events should still be filtered out
    events$.next(makeEvent(3, 'task-2'))
    events$.next(makeEvent(4, 'task-1'))

    const msg = await receiveMessage(ws) as { type: string; data: StoredEvent }
    expect(msg.data.streamId).toBe('task-1')
    ws.close()
  })

  // ── Pong-based Liveness (B30) ──

  it('initializes client with isAlive=true', async () => {
    const ws = await connectWs(port, TOKEN)
    // The server sets isAlive=true on connection — verified via the fact that
    // the connection persists (heartbeat check won't terminate it immediately)
    await waitMs(20)
    expect(wsServer.connectionCount).toBe(1)
    ws.close()
  })
})
