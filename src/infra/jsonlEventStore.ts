import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseDomainEvent, type DomainEvent, type StoredEvent } from '../domain/events.js'
import type { EventStore } from '../domain/ports/eventStore.js'

type JsonlEventRow = {
  id: number
  streamId: string
  seq: number
  type: string
  payload: unknown
  createdAt: string
}

type JsonlProjectionRow = {
  name: string
  cursorEventId: number
  stateJson: string
  updatedAt: string
}

export class JsonlEventStore implements EventStore {
  readonly #eventsPath: string
  readonly #projectionsPath: string

  constructor(opts: { eventsPath: string; projectionsPath?: string }) {
    this.#eventsPath = opts.eventsPath
    this.#projectionsPath = opts.projectionsPath ?? opts.eventsPath.replace(/events\.jsonl$/, 'projections.jsonl')
  }

  ensureSchema(): void {
    mkdirSync(dirname(this.#eventsPath), { recursive: true })
    mkdirSync(dirname(this.#projectionsPath), { recursive: true })
    if (!existsSync(this.#eventsPath)) writeFileSync(this.#eventsPath, '')
    if (!existsSync(this.#projectionsPath)) writeFileSync(this.#projectionsPath, '')
  }

  append(streamId: string, events: DomainEvent[]): StoredEvent[] {
    const now = new Date().toISOString()
    const existing = this.#readEvents()

    let currentMaxId = existing.length === 0 ? 0 : existing[existing.length - 1]!.id
    let currentSeq = 0
    for (const evt of existing) {
      if (evt.streamId === streamId) currentSeq = Math.max(currentSeq, evt.seq)
    }

    const stored: StoredEvent[] = []
    for (const evt of events) {
      currentMaxId += 1
      currentSeq += 1
      const row: JsonlEventRow = {
        id: currentMaxId,
        streamId,
        seq: currentSeq,
        type: evt.type,
        payload: evt.payload,
        createdAt: now
      }
      appendFileSync(this.#eventsPath, `${JSON.stringify(row)}\n`)
      stored.push({
        id: row.id,
        streamId: row.streamId,
        seq: row.seq,
        type: evt.type,
        payload: evt.payload as any,
        createdAt: row.createdAt
      })
    }

    return stored
  }

  readAll(fromIdExclusive = 0): StoredEvent[] {
    const rows = this.#readEvents()
    return rows.filter((r) => r.id > fromIdExclusive).map((r) => this.#rowToStoredEvent(r))
  }

  readStream(streamId: string, fromSeqInclusive = 1): StoredEvent[] {
    const rows = this.#readEvents()
    return rows
      .filter((r) => r.streamId === streamId && r.seq >= fromSeqInclusive)
      .map((r) => this.#rowToStoredEvent(r))
  }

  readById(id: number): StoredEvent | null {
    const rows = this.#readEvents()
    const row = rows.find((r) => r.id === id)
    if (!row) return null
    return this.#rowToStoredEvent(row)
  }

  getProjection<TState>(name: string, defaultState: TState): { cursorEventId: number; state: TState } {
    const row = this.#readProjection(name)
    if (!row) return { cursorEventId: 0, state: defaultState }
    return { cursorEventId: row.cursorEventId, state: JSON.parse(row.stateJson) as TState }
  }

  saveProjection<TState>(name: string, cursorEventId: number, state: TState): void {
    const row: JsonlProjectionRow = {
      name,
      cursorEventId,
      stateJson: JSON.stringify(state),
      updatedAt: new Date().toISOString()
    }
    appendFileSync(this.#projectionsPath, `${JSON.stringify(row)}\n`)
  }

  #readEvents(): JsonlEventRow[] {
    if (!existsSync(this.#eventsPath)) return []
    const raw = readFileSync(this.#eventsPath, 'utf8')
    if (!raw.trim()) return []
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonlEventRow)
  }

  #readProjection(name: string): JsonlProjectionRow | null {
    if (!existsSync(this.#projectionsPath)) return null
    const raw = readFileSync(this.#projectionsPath, 'utf8')
    if (!raw.trim()) return null

    let latest: JsonlProjectionRow | null = null
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const row = JSON.parse(trimmed) as JsonlProjectionRow
      if (row.name === name) latest = row
    }

    return latest
  }

  #rowToStoredEvent(row: JsonlEventRow): StoredEvent {
    const parsed = parseDomainEvent({ type: row.type, payload: row.payload })
    return {
      id: row.id,
      streamId: row.streamId,
      seq: row.seq,
      type: parsed.type,
      payload: parsed.payload as any,
      createdAt: row.createdAt
    }
  }
}
