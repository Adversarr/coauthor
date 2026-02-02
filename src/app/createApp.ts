import { join } from 'node:path'
import type { EventStore } from '../domain/ports/eventStore.js'
import { JsonlEventStore } from '../infra/jsonlEventStore.js'
import { TaskService, PatchService, EventService } from '../application/index.js'
import { ContextBuilder } from '../application/contextBuilder.js'
import { AgentRuntime } from '../agents/runtime.js'
import { FakeLLMClient } from '../infra/fakeLLMClient.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'
import type { LLMClient } from '../domain/ports/llmClient.js'

// App container: holds EventStore and Application Services
export type App = {
  baseDir: string
  storePath: string
  store: EventStore
  // Application Services
  taskService: TaskService
  patchService: PatchService
  eventService: EventService
  contextBuilder: ContextBuilder
  llm: LLMClient
  agentRuntime: AgentRuntime
}

// Create app: initialize EventStore + wire up services
export function createApp(opts: {
  baseDir: string
  eventsPath?: string
  projectionsPath?: string
  currentActorId?: string
  agentActorId?: string
  llm?: LLMClient
}): App {
  const baseDir = opts.baseDir
  const currentActorId = opts.currentActorId ?? DEFAULT_USER_ACTOR_ID
  const agentActorId = opts.agentActorId ?? DEFAULT_AGENT_ACTOR_ID

  const eventsPath = opts.eventsPath ?? join(baseDir, '.coauthor', 'events.jsonl')
  const store = new JsonlEventStore({ eventsPath, projectionsPath: opts.projectionsPath })
  const storePath = eventsPath

  store.ensureSchema()

  // Create application services
  const taskService = new TaskService(store, currentActorId)
  const patchService = new PatchService(store, baseDir, currentActorId)
  const eventService = new EventService(store)
  const contextBuilder = new ContextBuilder(baseDir)
  const llm = opts.llm ?? new FakeLLMClient()
  const agentRuntime = new AgentRuntime({ store, taskService, contextBuilder, llm, agentActorId })

  return { baseDir, storePath, store, taskService, patchService, eventService, contextBuilder, llm, agentRuntime }
}
