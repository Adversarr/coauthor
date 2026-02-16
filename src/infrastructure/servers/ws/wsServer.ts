/**
 * WebSocket Server — real-time event fanout to browser and remote TUI clients.
 *
 * Architecture:
 * - Attaches to an existing http.Server via `upgrade` event.
 * - Subscribes once to EventStore.events$ and UiBus.events$ globally.
 * - Per-connection subscription state: channels + optional streamId filter.
 * - Gap-filling: client sends lastEventId → server replays missed events.
 * - Heartbeat: server pongs on client pings; server-side idle detection via 60s timeout.
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Subscribable, Subscription } from '../../../core/ports/subscribable.js'
import type { StoredEvent } from '../../../core/events/events.js'
import type { UiEvent } from '../../../core/ports/uiBus.js'
import {
  parseClientMessage,
  serializeServerMessage,
  type Channel,
  type ServerMessage,
} from './protocol.js'

// ============================================================================
// Constants
// ============================================================================

/** Max events to replay during gap-fill (B23). */
const MAX_GAP_FILL_EVENTS = 1000
/** Max WebSocket payload size in bytes (B-NEW-C). */
const MAX_WS_PAYLOAD = 64 * 1024 // 64 KB
/** Max send buffer before closing slow client (B23). */
const MAX_BUFFERED_AMOUNT = 1024 * 1024 // 1 MB

// ============================================================================
// Types
// ============================================================================

export interface WsServerDeps {
  events$: Subscribable<StoredEvent>
  uiEvents$: Subscribable<UiEvent>
  /** Fetch events after a given ID (for gap-filling). */
  getEventsAfter: (fromIdExclusive: number) => Promise<StoredEvent[]>
  /** Auth token — must match `?token=` query param. */
  authToken: string
}

interface ClientState {
  channels: Set<Channel>
  /** If set, only matching task stream updates are forwarded. */
  streamId: string | null
  /** Whether the client has responded to the last ping. */
  isAlive: boolean
  /** Last event ID successfully delivered to this client (B1). */
  lastDeliveredEventId: number
}

// ============================================================================
// WebSocket Server
// ============================================================================

export class SeedWsServer {
  readonly #wss: WSServer
  readonly #deps: WsServerDeps
  readonly #clients = new Map<WebSocket, ClientState>()
  readonly #subscriptions: Subscription[] = []
  #attachedServer: HttpServer | null = null
  #upgradeHandler: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null = null
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined

  constructor(deps: WsServerDeps) {
    this.#deps = deps
    this.#wss = new WSServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD })
    this.#wss.on('connection', (ws) => this.#onConnection(ws))
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** Attach to an HTTP server — handles `upgrade` requests on `/ws`. */
  attach(server: HttpServer): void {
    // Idempotent attach: avoids duplicate upgrade listeners/subscriptions when
    // attach() is called multiple times in dev/HMR edge cases.
    if (this.#attachedServer === server) return
    if (this.#attachedServer && this.#attachedServer !== server) {
      throw new Error('[WsServer] Already attached to a different HTTP server')
    }

    this.#upgradeHandler = (req, socket, head) => {
      if (!this.#isWsPath(req)) {
        socket.destroy()
        return
      }
      if (!this.#authenticate(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      this.#wss.handleUpgrade(req, socket, head, (ws) => {
        this.#wss.emit('connection', ws, req)
      })
    }
    server.on('upgrade', this.#upgradeHandler)
    this.#attachedServer = server

    // Subscribe to global event streams (once)
    this.#subscriptions.push(
      this.#deps.events$.subscribe((event) => this.#broadcast('events', event)),
      this.#deps.uiEvents$.subscribe((event) => this.#broadcast('ui', event)),
    )

    // Server-side heartbeat: detect dead connections every 30s (B30)
    this.#heartbeatTimer = setInterval(() => {
      for (const [ws, state] of this.#clients) {
        if (!state.isAlive) {
          // No pong since last ping — terminate dead connection
          ws.terminate()
          this.#clients.delete(ws)
          continue
        }
        state.isAlive = false
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping()
        }
      }
    }, 30_000)
  }

  /** Gracefully shut down: close all connections, unsubscribe. */
  close(): void {
    if (this.#attachedServer && this.#upgradeHandler) {
      this.#attachedServer.off('upgrade', this.#upgradeHandler)
    }
    this.#attachedServer = null
    this.#upgradeHandler = null

    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = undefined
    }
    for (const sub of this.#subscriptions) sub.unsubscribe()
    this.#subscriptions.length = 0
    for (const [ws] of this.#clients) {
      ws.close(1001, 'Server shutting down')
    }
    this.#clients.clear()
    this.#wss.close()
  }

  /** Number of active connections (for testing/monitoring). */
  get connectionCount(): number {
    return this.#clients.size
  }

  // ── Connection Handling ──────────────────────────────────────────────

  #onConnection(ws: WebSocket): void {
    this.#clients.set(ws, { channels: new Set(), streamId: null, isAlive: true, lastDeliveredEventId: 0 })

    // Track pong responses for liveness detection (B30)
    ws.on('pong', () => {
      const state = this.#clients.get(ws)
      if (state) state.isAlive = true
    })

    ws.on('message', (raw) => {
      try {
        const msg = parseClientMessage(String(raw))
        switch (msg.type) {
          case 'subscribe':
            this.#handleSubscribe(ws, msg).catch(() => {
              this.#send(ws, { type: 'error', code: 'SUBSCRIBE_FAILED', message: 'Subscribe failed' })
            })
            break
          case 'unsubscribe':
            this.#handleUnsubscribe(ws, msg)
            break
          case 'ping':
            this.#send(ws, { type: 'pong' })
            break
        }
      } catch {
        this.#send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Malformed message' })
      }
    })

    ws.on('close', () => {
      this.#clients.delete(ws)
    })

    ws.on('error', (err) => {
      console.error('[WsServer] client error:', err.message)
      this.#clients.delete(ws)
    })
  }

  async #handleSubscribe(
    ws: WebSocket,
    msg: { channels: Channel[]; streamId?: string | null; lastEventId?: number },
  ): Promise<void> {
    const state = this.#clients.get(ws)
    if (!state) return
    for (const ch of msg.channels) state.channels.add(ch)
    // Allow setting or clearing stream filter (B35)
    // Explicit null clears the filter; undefined (missing field) leaves it unchanged
    if ('streamId' in msg) {
      state.streamId = msg.streamId ?? null
    }

    this.#send(ws, { type: 'subscribed', channels: [...state.channels] })

    // Gap-fill: send missed events with cap and dedup (B1, B23)
    if (msg.lastEventId !== undefined && state.channels.has('events')) {
      try {
        // Start from the higher of client-reported ID vs tracked ID to avoid dupes (B1)
        const startFrom = Math.max(msg.lastEventId, state.lastDeliveredEventId)
        const missed = await this.#deps.getEventsAfter(startFrom)
        let sent = 0
        const truncated = missed.length > MAX_GAP_FILL_EVENTS

        for (const event of missed) {
          if (sent >= MAX_GAP_FILL_EVENTS) break
          if (event.id <= state.lastDeliveredEventId) continue
          if (state.streamId && event.streamId !== state.streamId) continue
          // Backpressure: abort if client is slow (B23)
          if (ws.bufferedAmount > MAX_BUFFERED_AMOUNT) {
            ws.close(4008, 'Client too slow — gap-fill aborted')
            return
          }
          this.#send(ws, { type: 'event', data: event })
          state.lastDeliveredEventId = Math.max(state.lastDeliveredEventId, event.id)
          sent++
        }

        if (truncated) {
          this.#send(ws, {
            type: 'error',
            code: 'GAP_FILL_TRUNCATED',
            message: `Gap-fill limited to ${MAX_GAP_FILL_EVENTS} events. Full refresh recommended.`,
          })
        }
      } catch {
        this.#send(ws, { type: 'error', code: 'GAP_FILL_FAILED', message: 'Failed to replay events' })
      }
    }
  }

  #handleUnsubscribe(ws: WebSocket, msg: { channels: Channel[] }): void {
    const state = this.#clients.get(ws)
    if (!state) return
    for (const ch of msg.channels) state.channels.delete(ch)
  }

  // ── Broadcasting ─────────────────────────────────────────────────────

  #broadcast(channel: Channel, data: StoredEvent | UiEvent): void {
    const msgType = channel === 'events' ? 'event' : 'ui_event'
    for (const [ws, state] of this.#clients) {
      if (!state.channels.has(channel)) continue
      if (!this.#matchesStreamFilter(state, channel, data)) continue

      if (channel === 'events') {
        const event = data as StoredEvent
        // Defensive dedup: prevents replay-vs-live races from double-delivery.
        if (event.id <= state.lastDeliveredEventId) continue
      }

      this.#send(ws, { type: msgType, data } as ServerMessage)
      // Track delivered event ID (B1)
      if (channel === 'events') {
        state.lastDeliveredEventId = Math.max(state.lastDeliveredEventId, (data as StoredEvent).id)
      }
    }
  }

  #matchesStreamFilter(state: ClientState, channel: Channel, data: StoredEvent | UiEvent): boolean {
    if (!state.streamId) return true

    if (channel === 'events') {
      return (data as StoredEvent).streamId === state.streamId
    }

    const payload = (data as UiEvent).payload as Record<string, unknown> | undefined
    const taskId = typeof payload?.taskId === 'string' ? payload.taskId : null
    // UI events without task context remain unfiltered.
    if (!taskId) return true
    return taskId === state.streamId
  }

  // ── Auth & Utils ────────────────────────────────────────────────────

  #isWsPath(req: IncomingMessage): boolean {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    return url.pathname === '/ws'
  }

  #authenticate(req: IncomingMessage): boolean {
    // Localhost bypass: server binds 127.0.0.1 by default, so local connections
    // are trusted without token. This simplifies local development and CLI usage.
    // For remote deployments, the token query param is required.
    const socket = req.socket
    if (!socket) {
      // No socket available — reject (should not happen in normal HTTP upgrade)
      return false
    }
    const remoteAddr = socket.remoteAddress
    if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1') {
      return true
    }
    // Non-localhost: require valid token
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    return url.searchParams.get('token') === this.#deps.authToken
  }

  #send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serializeServerMessage(msg))
    }
  }
}
