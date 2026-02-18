/**
 * Shared test helper: InMemoryEventStore
 *
 * A simple in-memory EventStore implementation for unit tests
 * that don't need JSONL persistence.
 */

import { Subject } from 'rxjs'
import type { DomainEvent, StoredEvent } from '../../src/core/events/events.js'
import type { EventStore } from '../../src/core/ports/eventStore.js'

export class InMemoryEventStore implements EventStore {
  private events: StoredEvent[] = []
  public events$ = new Subject<StoredEvent>()

  async ensureSchema(): Promise<void> {}

  async append(streamId: string, events: DomainEvent[]): Promise<StoredEvent[]> {
    const currentStreamEvents = this.events.filter(ev => ev.streamId === streamId)
    const newStoredEvents = events.map((e, i) => ({
      id: this.events.length + i + 1,
      streamId,
      seq: currentStreamEvents.length + i + 1,
      ...e,
      createdAt: new Date().toISOString()
    })) as StoredEvent[]
    this.events.push(...newStoredEvents)
    newStoredEvents.forEach(e => this.events$.next(e))
    return newStoredEvents
  }

  async readStream(streamId: string): Promise<StoredEvent[]> {
    return this.events.filter(e => e.streamId === streamId)
  }

  async readAll(fromIdExclusive?: number): Promise<StoredEvent[]> {
    const startId = fromIdExclusive ?? 0
    return this.events.filter(e => e.id > startId)
  }

  async readById(id: number): Promise<StoredEvent | null> {
    return this.events.find(e => e.id === id) || null
  }

  async getProjection<TState>(name: string, defaultState: TState): Promise<{ cursorEventId: number; state: TState }> {
    return { cursorEventId: 0, state: defaultState }
  }

  async saveProjection(): Promise<void> {}
}
