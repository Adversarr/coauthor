/**
 * Domain Layer - Ports
 *
 * This module defines the EventStore port interface.
 * Infrastructure layer provides implementations.
 */

import type { DomainEvent, StoredEvent } from '../events.js'

/**
 * EventStore port interface.
 *
 * All event storage implementations must implement this interface.
 * This allows swapping between different backends.
 */
export interface EventStore {
  /**
   * Initialize the storage schema (create tables, files, etc.)
   */
  ensureSchema(): void

  /**
   * Append events to a stream.
   *
   * @param streamId - The stream identifier (typically taskId)
   * @param events - Events to append
   * @returns The stored events with assigned IDs and sequence numbers
   */
  append(streamId: string, events: DomainEvent[]): StoredEvent[]

  /**
   * Read all events from the store.
   *
   * @param fromIdExclusive - Start reading after this event ID (0 = from beginning)
   * @returns All events after the specified ID
   */
  readAll(fromIdExclusive?: number): StoredEvent[]

  /**
   * Read events from a specific stream.
   *
   * @param streamId - The stream identifier
   * @param fromSeqInclusive - Start reading from this sequence number (1 = from beginning)
   * @returns Events in the stream from the specified sequence
   */
  readStream(streamId: string, fromSeqInclusive?: number): StoredEvent[]

  /**
   * Read a single event by ID.
   *
   * @param id - The event ID
   * @returns The event or null if not found
   */
  readById(id: number): StoredEvent | null

  /**
   * Get projection state.
   *
   * @param name - Projection name
   * @param defaultState - Default state if projection doesn't exist
   * @returns Current cursor position and state
   */
  getProjection<TState>(name: string, defaultState: TState): {
    cursorEventId: number
    state: TState
  }

  /**
   * Save projection state.
   *
   * @param name - Projection name
   * @param cursorEventId - Last processed event ID
   * @param state - Current projection state
   */
  saveProjection<TState>(name: string, cursorEventId: number, state: TState): void
}
