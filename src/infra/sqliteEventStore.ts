import type { DatabaseSync } from 'node:sqlite'
import { parseDomainEvent, type DomainEvent, type StoredEvent } from '../domain/events.js'
import type { EventStore } from '../domain/ports/eventStore.js'

type EventRow = {
  id: number
  stream_id: string
  seq: number
  type: string
  payload_json: string
  created_at: string
}

export class SqliteEventStore implements EventStore {
  readonly #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  ensureSchema(): void {
    this.#db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(stream_id, seq)
      );

      CREATE INDEX IF NOT EXISTS idx_events_stream_seq ON events(stream_id, seq);
      CREATE INDEX IF NOT EXISTS idx_events_id ON events(id);

      CREATE TABLE IF NOT EXISTS projections (
        name TEXT PRIMARY KEY,
        cursor_event_id INTEGER NOT NULL,
        state_json TEXT NOT NULL
      );
    `)
  }

  append(streamId: string, events: DomainEvent[]): StoredEvent[] {
    const now = new Date().toISOString()

    const readSeqStmt = this.#db.prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM events WHERE stream_id = ?')
    const insertStmt = this.#db.prepare(
      'INSERT INTO events (stream_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id'
    )

    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const currentSeq = (readSeqStmt.get(streamId) as any)?.max_seq ?? 0
      const stored: StoredEvent[] = []

      events.forEach((evt, index) => {
        const seq = currentSeq + index + 1
        const payloadJson = JSON.stringify(evt.payload)
        const row = insertStmt.get(streamId, seq, evt.type, payloadJson, now) as any

        stored.push({
          id: Number(row.id),
          streamId,
          seq,
          type: evt.type,
          payload: evt.payload as any,
          createdAt: now
        })
      })

      this.#db.exec('COMMIT')
      return stored
    } catch (e) {
      this.#db.exec('ROLLBACK')
      throw e
    }
  }

  readAll(fromIdExclusive = 0): StoredEvent[] {
    const stmt = this.#db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id ASC')
    return (stmt.all(fromIdExclusive) as EventRow[]).map((r) => this.#rowToStoredEvent(r))
  }

  readStream(streamId: string, fromSeqInclusive = 1): StoredEvent[] {
    const stmt = this.#db.prepare('SELECT * FROM events WHERE stream_id = ? AND seq >= ? ORDER BY seq ASC')
    return (stmt.all(streamId, fromSeqInclusive) as EventRow[]).map((r) => this.#rowToStoredEvent(r))
  }

  readById(id: number): StoredEvent | null {
    const stmt = this.#db.prepare('SELECT * FROM events WHERE id = ?')
    const row = stmt.get(id) as EventRow | undefined
    if (!row) return null
    return this.#rowToStoredEvent(row)
  }

  getProjection<TState>(name: string, defaultState: TState): { cursorEventId: number; state: TState } {
    const stmt = this.#db.prepare('SELECT cursor_event_id, state_json FROM projections WHERE name = ?')
    const row = stmt.get(name) as { cursor_event_id: number; state_json: string } | undefined
    if (!row) return { cursorEventId: 0, state: defaultState }
    return { cursorEventId: row.cursor_event_id, state: JSON.parse(row.state_json) as TState }
  }

  saveProjection<TState>(name: string, cursorEventId: number, state: TState): void {
    const stmt = this.#db.prepare(`
      INSERT INTO projections (name, cursor_event_id, state_json)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET cursor_event_id = excluded.cursor_event_id, state_json = excluded.state_json
    `)
    stmt.run(name, cursorEventId, JSON.stringify(state))
  }

  #rowToStoredEvent(row: EventRow): StoredEvent {
    const parsed = parseDomainEvent({ type: row.type, payload: JSON.parse(row.payload_json) })
    return {
      id: row.id,
      streamId: row.stream_id,
      seq: row.seq,
      type: parsed.type,
      payload: parsed.payload as any,
      createdAt: row.created_at
    }
  }
}
