/**
 * WebSocket service — connects to the CoAuthor backend for real-time events.
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Gap-filling via lastEventId
 * - Typed event callbacks
 */

import type { StoredEvent, UiEvent, WsClientMessage, WsServerMessage } from '@/types'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface WsCallbacks {
  onEvent?: (event: StoredEvent) => void
  onUiEvent?: (event: UiEvent) => void
  onStatusChange?: (status: ConnectionStatus) => void
}

const LAST_EVENT_ID_STORAGE_KEY = 'coauthor-last-event-id'

function readPersistedLastEventId(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.sessionStorage.getItem(LAST_EVENT_ID_STORAGE_KEY)
    if (!raw) return 0
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  } catch {
    return 0
  }
}

function persistLastEventId(id: number): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(LAST_EVENT_ID_STORAGE_KEY, String(id))
  } catch {
    // Best-effort persistence only.
  }
}

export class WsService {
  #ws: WebSocket | null = null
  #callbacks: WsCallbacks
  #lastEventId = readPersistedLastEventId()
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #reconnectDelay = 1000
  #disposed = false
  #subscribedChannels: ('events' | 'ui')[] = ['events', 'ui']

  constructor(callbacks: WsCallbacks) {
    this.#callbacks = callbacks
  }

  connect(): void {
    if (this.#disposed) return
    const token = sessionStorage.getItem('coauthor-token') ?? ''
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`

    this.#callbacks.onStatusChange?.('connecting')

    const ws = new WebSocket(url)
    this.#ws = ws

    ws.onopen = () => {
      this.#callbacks.onStatusChange?.('connected')
      this.#reconnectDelay = 1000
      // Subscribe with gap-fill
      const msg: WsClientMessage = {
        type: 'subscribe',
        channels: this.#subscribedChannels,
        lastEventId: this.#lastEventId,
      }
      ws.send(JSON.stringify(msg))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as WsServerMessage
        switch (msg.type) {
          case 'event':
            this.#lastEventId = Math.max(this.#lastEventId, msg.data.id)
            persistLastEventId(this.#lastEventId)
            this.#callbacks.onEvent?.(msg.data)
            break
          case 'ui_event':
            this.#callbacks.onUiEvent?.(msg.data)
            break
          case 'subscribed':
          case 'pong':
            break
          case 'error':
            console.warn('[ws] server error:', msg.code, msg.message)
            break
        }
      } catch {
        console.warn('[ws] failed to parse message')
      }
    }

    ws.onclose = () => {
      this.#ws = null // Clean up reference (B2/E)
      this.#callbacks.onStatusChange?.('disconnected')
      this.#scheduleReconnect()
    }

    ws.onerror = () => {
      this.#ws = null // Clean up reference (B2)
      ws.close()
    }
  }

  disconnect(): void {
    this.#disposed = true
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#ws?.close()
    this.#ws = null
  }

  get lastEventId(): number { return this.#lastEventId }
  set lastEventId(id: number) {
    this.#lastEventId = Math.max(0, id)
    persistLastEventId(this.#lastEventId)
  }

  #scheduleReconnect(): void {
    if (this.#disposed) return
    // Clear any existing timer to prevent overlapping reconnections (F4)
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      if (this.#disposed) return // Re-check after timeout (B3)
      this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, 30_000)
      this.connect()
    }, this.#reconnectDelay)
  }
}
