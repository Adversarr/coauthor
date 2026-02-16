/**
 * Remote EventStore — delegates reads to HTTP API, events$ backed by WebSocket.
 *
 * Writes (append, saveProjection) throw: only the master process can write.
 */

import type { EventStore } from '../../core/ports/eventStore.js'
import type { Subscribable } from '../../core/ports/subscribable.js'
import type { DomainEvent, StoredEvent } from '../../core/events/events.js'
import type { SeedWsClient } from './wsClient.js'
import type { RemoteHttpClient } from './httpClient.js'

export class RemoteEventStore implements EventStore {
  readonly #http: RemoteHttpClient
  readonly #ws: SeedWsClient

  constructor(http: RemoteHttpClient, ws: SeedWsClient) {
    this.#http = http
    this.#ws = ws
  }

  get events$(): Subscribable<StoredEvent> {
    return this.#ws.events$
  }

  async ensureSchema(): Promise<void> {
    // No-op: master owns the schema
  }

  async append(_streamId: string, _events: DomainEvent[]): Promise<StoredEvent[]> {
    throw new Error('Cannot append events in client mode — use HTTP API commands')
  }

  async readAll(fromIdExclusive?: number): Promise<StoredEvent[]> {
    const { events } = await this.#http.get<{ events: StoredEvent[] }>(
      `/api/events?after=${fromIdExclusive ?? 0}`,
    )
    return events
  }

  async readStream(streamId: string, _fromSeqInclusive?: number): Promise<StoredEvent[]> {
    const { events } = await this.#http.get<{ events: StoredEvent[] }>(
      `/api/tasks/${streamId}/events`,
    )
    return events
  }

  async readById(id: number): Promise<StoredEvent | null> {
    try {
      return await this.#http.get<StoredEvent>(`/api/events/${id}`)
    } catch {
      return null
    }
  }

  async getProjection<TState>(_name: string, defaultState: TState): Promise<{ cursorEventId: number; state: TState }> {
    // Client mode doesn't own projections — return defaults, re-project from events
    return { cursorEventId: 0, state: defaultState }
  }

  async saveProjection(): Promise<void> {
    // No-op in client mode
  }
}
