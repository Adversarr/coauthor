import type { DomainEvent, StoredEvent } from './domain.js'

export interface EventStore {
  ensureSchema(): void
  append(streamId: string, events: DomainEvent[]): StoredEvent[]
  readAll(fromIdExclusive?: number): StoredEvent[]
  readStream(streamId: string, fromSeqInclusive?: number): StoredEvent[]
  readById(id: number): StoredEvent | null
  getProjection<TState>(name: string, defaultState: TState): { cursorEventId: number; state: TState }
  saveProjection<TState>(name: string, cursorEventId: number, state: TState): void
}
