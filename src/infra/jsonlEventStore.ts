import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Subject, type Observable } from 'rxjs'
import { parseDomainEvent, type DomainEvent, type StoredEvent } from '../domain/events.js'
import type { EventStore } from '../domain/ports/eventStore.js'

// JSONL row format for events
type JsonlEventRow = {
  id: number
  streamId: string
  seq: number
  type: string
  payload: unknown
  createdAt: string
}

// Type-safe helper to construct StoredEvent from DomainEvent
// This avoids `as any` by using type intersection properly
function toStoredEvent(
  meta: { id: number; streamId: string; seq: number; createdAt: string },
  evt: DomainEvent
): StoredEvent {
  return {
    ...meta,
    type: evt.type,
    payload: evt.payload
  } as StoredEvent
}

// JSONL row format for projections
type JsonlProjectionRow = {
  name: string
  cursorEventId: number
  stateJson: string
  updatedAt: string
}

const lockBlocker = new Int32Array(new SharedArrayBuffer(4))
function sleepSync(ms: number): void {
  Atomics.wait(lockBlocker, 0, 0, ms)
}

// Event store adapter: append-only log in JSONL format
export class JsonlEventStore implements EventStore {
  readonly #eventsPath: string
  readonly #projectionsPath: string

  // RxJS Subject for event streaming
  readonly #eventSubject = new Subject<StoredEvent>()

  // Caching for performance: avoid full-read on every append()
  #maxId = 0
  #streamSeqs = new Map<string, number>()
  #cacheInitialized = false

  constructor(opts: { eventsPath: string; projectionsPath?: string }) {
    this.#eventsPath = opts.eventsPath
    this.#projectionsPath = opts.projectionsPath ?? opts.eventsPath.replace(/events\.jsonl$/, 'projections.jsonl')
  }

  /** Observable stream of new events */
  get events$(): Observable<StoredEvent> {
    return this.#eventSubject.asObservable()
  }

  #ensureCacheInitialized(): void {
    if (this.#cacheInitialized) return
    this.#rebuildCacheFromDisk()
  }

  ensureSchema(): void {
    mkdirSync(dirname(this.#eventsPath), { recursive: true })
    mkdirSync(dirname(this.#projectionsPath), { recursive: true })
    if (!existsSync(this.#eventsPath)) writeFileSync(this.#eventsPath, '')
    if (!existsSync(this.#projectionsPath)) writeFileSync(this.#projectionsPath, '')
  }

  append(streamId: string, events: DomainEvent[]): StoredEvent[] {
    this.#ensureCacheInitialized()
    const stored = this.#withLock(`${this.#eventsPath}.lock`, () => {
      this.#rebuildCacheFromDisk()
      const now = new Date().toISOString()

      let currentMaxId = this.#maxId
      let currentSeq = this.#streamSeqs.get(streamId) ?? 0

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
        const storedEvent = toStoredEvent(
          { id: row.id, streamId: row.streamId, seq: row.seq, createdAt: row.createdAt },
          evt
        )
        stored.push(storedEvent)
      }

      this.#maxId = currentMaxId
      this.#streamSeqs.set(streamId, currentSeq)

      return stored
    })
    for (const e of stored) this.#eventSubject.next(e)
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
    this.#withLock(`${this.#projectionsPath}.lock`, () => {
      const existing = this.#readAllProjections()
      existing.set(name, {
        name,
        cursorEventId,
        stateJson: JSON.stringify(state),
        updatedAt: new Date().toISOString()
      })

      const content = [...existing.values()].map((r) => JSON.stringify(r)).join('\n') + '\n'
      const tmpPath = `${this.#projectionsPath}.${process.pid}.${Date.now()}.tmp`
      try {
        writeFileSync(tmpPath, content)
        renameSync(tmpPath, this.#projectionsPath)
      } finally {
        if (existsSync(tmpPath)) {
          unlinkSync(tmpPath)
        }
      }
    })
  }

  #readAllProjections(): Map<string, JsonlProjectionRow> {
    const result = new Map<string, JsonlProjectionRow>()
    if (!existsSync(this.#projectionsPath)) return result
    const raw = readFileSync(this.#projectionsPath, 'utf8')
    if (!raw.trim()) return result

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const row = JSON.parse(trimmed) as JsonlProjectionRow
        result.set(row.name, row)
      } catch {
        continue
      }
    }
    return result
  }

  #readEvents(): JsonlEventRow[] {
    if (!existsSync(this.#eventsPath)) return []
    const raw = readFileSync(this.#eventsPath, 'utf8')
    if (!raw.trim()) return []
    const rows: JsonlEventRow[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        rows.push(JSON.parse(trimmed) as JsonlEventRow)
      } catch {
        continue
      }
    }
    return rows
  }

  #readProjection(name: string): JsonlProjectionRow | null {
    if (!existsSync(this.#projectionsPath)) return null
    const raw = readFileSync(this.#projectionsPath, 'utf8')
    if (!raw.trim()) return null

    let latest: JsonlProjectionRow | null = null
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const row = JSON.parse(trimmed) as JsonlProjectionRow
        if (row.name === name) latest = row
      } catch {
        continue
      }
    }

    return latest
  }

  #rowToStoredEvent(row: JsonlEventRow): StoredEvent {
    const parsed = parseDomainEvent({ type: row.type, payload: row.payload })
    return toStoredEvent(
      { id: row.id, streamId: row.streamId, seq: row.seq, createdAt: row.createdAt },
      parsed
    )
  }

  #rebuildCacheFromDisk(): void {
    this.#maxId = 0
    this.#streamSeqs = new Map<string, number>()
    const events = this.#readEvents()
    for (const e of events) {
      this.#maxId = Math.max(this.#maxId, e.id)
      const curr = this.#streamSeqs.get(e.streamId) ?? 0
      this.#streamSeqs.set(e.streamId, Math.max(curr, e.seq))
    }
    this.#cacheInitialized = true
  }

  #withLock<T>(lockPath: string, fn: () => T): T {
    const start = Date.now()
    while (true) {
      try {
        const fd = openSync(lockPath, 'wx')
        try {
          return fn()
        } finally {
          closeSync(fd)
          unlinkSync(lockPath)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (Date.now() - start > 2000) throw new Error(`锁超时：${lockPath}`)
        sleepSync(10)
      }
    }
  }
}
