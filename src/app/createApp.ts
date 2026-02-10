import { join, resolve } from 'node:path'
import type { EventStore } from '../domain/ports/eventStore.js'
import type { ArtifactStore } from '../domain/ports/artifactStore.js'
import type { ToolRegistry, ToolExecutor } from '../domain/ports/tool.js'
import type { AuditLog } from '../domain/ports/auditLog.js'
import type { ConversationStore } from '../domain/ports/conversationStore.js'
import type { LLMClient } from '../domain/ports/llmClient.js'
import type { UiBus } from '../domain/ports/uiBus.js'
import type { Agent } from '../agents/agent.js'
import { RuntimeManager } from '../agents/runtimeManager.js'
import { JsonlEventStore } from '../infra/jsonlEventStore.js'
import { FsArtifactStore } from '../infra/fsArtifactStore.js'
import { JsonlAuditLog } from '../infra/jsonlAuditLog.js'
import { JsonlConversationStore } from '../infra/jsonlConversationStore.js'
import { DefaultToolRegistry } from '../infra/toolRegistry.js'
import { registerBuiltinTools } from '../infra/tools/index.js'
import { registerSubtaskTools } from '../infra/tools/createSubtaskTool.js'
import { DefaultToolExecutor } from '../infra/toolExecutor.js'
import { createUiBus } from '../infra/subjectUiBus.js'
import { TaskService, EventService, InteractionService, AuditService } from '../application/index.js'
import { ContextBuilder } from '../application/contextBuilder.js'
import { ConversationManager } from '../agents/conversationManager.js'
import { OutputHandler } from '../agents/outputHandler.js'
import { DefaultCoAuthorAgent } from '../agents/defaultAgent.js'
import { SearchAgent } from '../agents/searchAgent.js'
import { MinimalAgent } from '../agents/minimalAgent.js'
import { FakeLLMClient } from '../infra/fakeLLMClient.js'
import { OpenAILLMClient } from '../infra/openaiLLMClient.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'
import { loadAppConfig, type AppConfig } from '../config/appConfig.js'
import { ConsoleTelemetrySink, NoopTelemetrySink, type TelemetrySink } from '../domain/ports/telemetry.js'

// ============================================================================
// App Container
// ============================================================================

/**
 * App container: holds all wired-up services.
 * 
 * Infrastructure:
 * - store: EventStore for domain events (User ↔ Agent decisions)
 * - auditLog: AuditLog for tool call tracing (Agent ↔ Tools/Files)
 * - conversationStore: ConversationStore for LLM context (Agent ↔ LLM)
 * - toolRegistry: Tool definitions
 * - toolExecutor: Tool execution with audit logging
 * 
 * Application Services:
 * - taskService: Task CRUD
 * - eventService: Event replay
 * - interactionService: UIP handling
 * - contextBuilder: LLM context building
 * 
 * Agent:
 * - runtimeManager: Agent runtime orchestration (owns task-scoped AgentRuntimes)
 */
export type App = {
  baseDir: string
  storePath: string
  auditLogPath: string
  conversationsPath: string
  
  // Infrastructure
  store: EventStore
  artifactStore: ArtifactStore
  auditLog: AuditLog
  conversationStore: ConversationStore
  telemetry: TelemetrySink
  toolRegistry: ToolRegistry
  toolExecutor: ToolExecutor
  llm: LLMClient
  uiBus: UiBus
  
  // Application Services
  taskService: TaskService
  eventService: EventService
  interactionService: InteractionService
  auditService: AuditService
  contextBuilder: ContextBuilder
  
  // Agent
  runtimeManager: RuntimeManager
}

// ============================================================================
// Create App
// ============================================================================

export type CreateAppOptions = {
  baseDir: string
  eventsPath?: string
  auditLogPath?: string
  conversationsPath?: string
  projectionsPath?: string
  currentActorId?: string
  /** Override the default agent (first registered). Other built-in agents still register. */
  agent?: Agent
  llm?: LLMClient
  toolRegistry?: ToolRegistry
  conversationStore?: ConversationStore
  config?: AppConfig
}

/**
 * Create and wire up the application.
 * 
 * This is the composition root where all dependencies are assembled.
 */
export async function createApp(opts: CreateAppOptions): Promise<App> {
  const baseDir = resolve(opts.baseDir)
  const currentActorId = opts.currentActorId ?? DEFAULT_USER_ACTOR_ID
  const config = opts.config ?? loadAppConfig(process.env)

  // === Infrastructure Layer ===
  
  // Event Store (User ↔ Agent decisions)
  const eventsPath = opts.eventsPath ?? join(baseDir, '.coauthor', 'events.jsonl')
  const store = new JsonlEventStore({ eventsPath, projectionsPath: opts.projectionsPath })
  await store.ensureSchema()

  // Artifact Store (File access)
  const artifactStore = new FsArtifactStore(baseDir)

  // Audit Log (Agent ↔ Tools/Files)
  const auditLogPath = opts.auditLogPath ?? join(baseDir, '.coauthor', 'audit.jsonl')
  const auditLog = new JsonlAuditLog({ auditPath: auditLogPath })
  await auditLog.ensureSchema()

  // Conversation Store (Agent ↔ LLM context persistence)
  const conversationsPath = opts.conversationsPath ?? join(baseDir, '.coauthor', 'conversations.jsonl')
  const conversationStore = opts.conversationStore ?? new JsonlConversationStore({ conversationsPath })
  if (!opts.conversationStore) {
    await conversationStore.ensureSchema()
  }

  // Tool Registry
  const toolRegistry = opts.toolRegistry ?? new DefaultToolRegistry()
  if (!opts.toolRegistry) {
    registerBuiltinTools(toolRegistry as DefaultToolRegistry, {
      runCommand: {
        maxOutputLength: config.resources.maxOutputLength,
        defaultTimeout: config.timeouts.exec
      }
    })
  }

  // Tool Executor
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })

  const uiBus = createUiBus()
  auditLog.entries$.subscribe((entry) => {
    uiBus.emit({ type: 'audit_entry', payload: entry })
  })

  const telemetry: TelemetrySink =
    config.telemetry.sink === 'console' ? new ConsoleTelemetrySink() : new NoopTelemetrySink()

  // LLM Client
  const llm =
    opts.llm ??
    (config.llm.provider === 'openai'
      ? new OpenAILLMClient({
          apiKey: config.llm.openai.apiKey,
          baseURL: config.llm.openai.baseURL,
          modelByProfile: config.llm.openai.modelByProfile,
          toolSchemaStrategy: config.toolSchema.strategy,
        })
      : new FakeLLMClient())

  // === Application Layer ===
  
  const taskService = new TaskService(store, currentActorId, config.task.defaultPriority)
  const eventService = new EventService(store)
  const interactionService = new InteractionService(store, currentActorId, config.timeouts.interaction)
  const auditService = new AuditService(auditLog, config.resources.auditLogLimit)
  const contextBuilder = new ContextBuilder(baseDir, artifactStore)

  // === Agent Layer ===
  
  const defaultAgent = opts.agent ?? new DefaultCoAuthorAgent({
    contextBuilder,
    maxIterations: config.agent.maxIterations,
    maxTokens: config.agent.maxTokens,
    defaultProfile: config.agent.defaultProfile
  })
  const searchAgent = new SearchAgent({
    contextBuilder,
    maxIterations: config.agent.maxIterations,
    maxTokens: config.agent.maxTokens,
    defaultProfile: config.agent.defaultProfile
  })
  const minimalAgent = new MinimalAgent({
    contextBuilder,
    maxTokens: config.agent.maxTokens,
    defaultProfile: config.agent.defaultProfile
  })

  const conversationManager = new ConversationManager({
    conversationStore,
    auditLog,
    toolRegistry,
    toolExecutor,
    artifactStore,
    telemetry
  })

  const outputHandler = new OutputHandler({
    toolExecutor,
    toolRegistry,
    artifactStore,
    uiBus,
    conversationManager,
    telemetry
  })

  const runtimeManager = new RuntimeManager({
    store,
    taskService,
    llm,
    toolRegistry,
    baseDir,
    conversationManager,
    outputHandler
  })
  runtimeManager.registerAgent(defaultAgent)
  runtimeManager.registerAgent(searchAgent)
  runtimeManager.registerAgent(minimalAgent)

  // Register subtask tools (one per agent) — must happen AFTER agent registration
  registerSubtaskTools(toolRegistry, {
    store,
    taskService,
    conversationStore,
    runtimeManager,
    maxSubtaskDepth: config.maxSubtaskDepth ?? 3
  })

  return {
    baseDir,
    storePath: eventsPath,
    auditLogPath,
    conversationsPath,
    // Infrastructure
    store,
    artifactStore,
    auditLog,
    conversationStore,
    telemetry,
    toolRegistry,
    toolExecutor,
    llm,
    uiBus,
    // Application Services
    taskService,
    eventService,
    interactionService,
    auditService,
    contextBuilder,
    // Agent
    runtimeManager
  }
}
