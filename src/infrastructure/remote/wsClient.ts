/**
 * WebSocket client — connects to a Seed master server.
 *
 * Features:
 * - Auto-reconnect with exponential backoff (1s → 2s → 4s → max 30s).
 * - lastEventId tracking for gap-filling on reconnect.
 * - Channel subscription management.
 * - Emits typed events to registered listeners.
 */

import { WebSocket } from 'ws'
import { Subject } from 'rxjs'
import type { StoredEvent } from '../../core/events/events.js'
import type { UiEvent } from '../../core/ports/uiBus.js'
import type { Subscribable } from '../../core/ports/subscribable.js'
import type { ServerMessage, Channel } from '../servers/ws/protocol.js'

// ============================================================================
// Types
// ============================================================================

export interface WsClientOptions {
  port: number
  host?: string
  token: string
  channels?: Channel[]
  autoReconnect?: boolean
}

export type WsConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

// ============================================================================
// Client
// ============================================================================

export class SeedWsClient {
  readonly #opts: Required<Omit<WsClientOptions, 'channels'>> & { channels: Channel[] }
  readonly #events$ = new Subject<StoredEvent>()
  readonly #uiEvents$ = new Subject<UiEvent>()
  readonly #status$ = new Subject<WsConnectionStatus>()

  #ws: WebSocket | null = null
  #lastEventId = 0
  #reconnectAttempt = 0
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined
  #stopped = false

  constructor(opts: WsClientOptions) {
    this.#opts = {
      host: '127.0.0.1',
      autoReconnect: true,
      channels: ['events', 'ui'],
      ...opts,
    }
  }

  // ── Subscribable Streams ──

  get events$(): Subscribable<StoredEvent> { return this.#events$.asObservable() }
  get uiEvents$(): Subscribable<UiEvent> { return this.#uiEvents$.asObservable() }
  get status$(): Subscribable<WsConnectionStatus> { return this.#status$.asObservable() }

  get lastEventId(): number { return this.#lastEventId }

  // ── Lifecycle ──

  connect(): void {
    this.#stopped = false
    this.#doConnect()
  }

  disconnect(): void {
    this.#stopped = true
    this.#stopHeartbeat()
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = undefined
    }
    if (this.#ws) {
      this.#ws.close(1000, 'Client disconnect')
      this.#ws = null
    }
    this.#status$.next('disconnected')
  }

  // ── Internal ──

  #doConnect(): void {
    const url = `ws://${this.#opts.host}:${this.#opts.port}/ws?token=${encodeURIComponent(this.#opts.token)}`
    this.#status$.next('connecting')

    const ws = new WebSocket(url)
    this.#ws = ws

    ws.on('open', () => {
      this.#reconnectAttempt = 0
      this.#status$.next('connected')
      // Subscribe to channels with gap-fill
      ws.send(JSON.stringify({
        type: 'subscribe',
        channels: this.#opts.channels,
        lastEventId: this.#lastEventId > 0 ? this.#lastEventId : undefined,
      }))
      // Start client-side heartbeat (B7)
      this.#startHeartbeat()
    })

    ws.on('message', (raw) => {
      try {
        const msg: ServerMessage = JSON.parse(String(raw))
        switch (msg.type) {
          case 'event': {
            const event = msg.data as StoredEvent
            if (event.id > this.#lastEventId) this.#lastEventId = event.id
            this.#events$.next(event)
            break
          }
          case 'ui_event':
            this.#uiEvents$.next(msg.data as UiEvent)
            break
          // subscribed, pong, error are informational — ignore for now
        }
      } catch {
        // Ignore malformed messages
      }
    })

    ws.on('close', () => {
      this.#ws = null
      if (!this.#stopped && this.#opts.autoReconnect) {
        this.#scheduleReconnect()
      } else {
        this.#status$.next('disconnected')
      }
    })

    ws.on('error', () => {
      this.#status$.next('error')
      // `close` event will follow
    })
  }

  #scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.#reconnectAttempt, 30_000)
    this.#reconnectAttempt++
    this.#stopHeartbeat()
    this.#status$.next('disconnected')
    this.#reconnectTimer = setTimeout(() => {
      if (!this.#stopped) this.#doConnect()
    }, delay)
  }

  /** Send periodic pings to detect dead connections (B7). */
  #startHeartbeat(): void {
    this.#stopHeartbeat()
    this.#heartbeatTimer = setInterval(() => {
      if (this.#ws?.readyState === WebSocket.OPEN) {
        this.#ws.ping()
      }
    }, 25_000)
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = undefined
    }
  }
}
