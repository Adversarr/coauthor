import { join } from 'node:path'
import type { EventStore } from '../domain/ports/eventStore.js'
import { JsonlEventStore } from '../infra/jsonlEventStore.js'
import { openSqliteDb } from '../infra/sqlite.js'
import { SqliteEventStore } from '../infra/sqliteEventStore.js'
import { TaskService, PatchService, EventService } from '../application/index.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'

export type App = {
  baseDir: string
  storePath: string
  store: EventStore
  // Application Services
  taskService: TaskService
  patchService: PatchService
  eventService: EventService
}

export function createApp(opts: {
  baseDir: string
  dbPath?: string
  eventsPath?: string
  projectionsPath?: string
  store?: 'jsonl' | 'sqlite'
  currentActorId?: string
}): App {
  const baseDir = opts.baseDir
  const currentActorId = opts.currentActorId ?? DEFAULT_USER_ACTOR_ID

  let store: EventStore
  let storePath: string

  if (opts.store === 'sqlite') {
    const dbPath = opts.dbPath ?? join(baseDir, '.coauthor', 'coauthor.db')
    store = new SqliteEventStore(openSqliteDb(dbPath))
    storePath = dbPath
  } else {
    const eventsPath = opts.eventsPath ?? join(baseDir, '.coauthor', 'events.jsonl')
    store = new JsonlEventStore({ eventsPath })
    storePath = eventsPath
  }

  store.ensureSchema()

  // Create application services
  const taskService = new TaskService(store, currentActorId)
  const patchService = new PatchService(store, baseDir, currentActorId)
  const eventService = new EventService(store)

  return { baseDir, storePath, store, taskService, patchService, eventService }
}

