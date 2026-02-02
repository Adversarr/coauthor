import { join } from 'node:path'
import type { EventStore } from '../domain/ports/eventStore.js'
import { JsonlEventStore } from '../infra/jsonlEventStore.js'
import { TaskService, PatchService, EventService } from '../application/index.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'

// App container: holds EventStore and Application Services
export type App = {
  baseDir: string
  storePath: string
  store: EventStore
  // Application Services
  taskService: TaskService
  patchService: PatchService
  eventService: EventService
}

// Create app: initialize EventStore + wire up services
export function createApp(opts: {
  baseDir: string
  eventsPath?: string
  projectionsPath?: string
  currentActorId?: string
}): App {
  const baseDir = opts.baseDir
  const currentActorId = opts.currentActorId ?? DEFAULT_USER_ACTOR_ID

  const eventsPath = opts.eventsPath ?? join(baseDir, '.coauthor', 'events.jsonl')
  const store = new JsonlEventStore({ eventsPath, projectionsPath: opts.projectionsPath })
  const storePath = eventsPath

  store.ensureSchema()

  // Create application services
  const taskService = new TaskService(store, currentActorId)
  const patchService = new PatchService(store, baseDir, currentActorId)
  const eventService = new EventService(store)

  return { baseDir, storePath, store, taskService, patchService, eventService }
}
