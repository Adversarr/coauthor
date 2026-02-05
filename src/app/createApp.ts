import { join } from 'node:path'
import type { EventStore } from '../domain/ports/eventStore.js'
import type { ToolRegistry, ToolExecutor } from '../domain/ports/tool.js'
import type { AuditLog } from '../domain/ports/auditLog.js'
import type { ConversationStore } from '../domain/ports/conversationStore.js'
import type { LLMClient } from '../domain/ports/llmClient.js'
import type { Agent } from '../agents/agent.js'
import { JsonlEventStore } from '../infra/jsonlEventStore.js'
import { JsonlAuditLog } from '../infra/jsonlAuditLog.js'
import { JsonlConversationStore } from '../infra/jsonlConversationStore.js'
import { DefaultToolRegistry } from '../infra/toolRegistry.js'
import { registerBuiltinTools } from '../infra/tools/index.js'
import { DefaultToolExecutor } from '../infra/toolExecutor.js'
import { TaskService, EventService, InteractionService, AuditService } from '../application/index.js'
import { ContextBuilder } from '../application/contextBuilder.js'
import { AgentRuntime } from '../agents/runtime.js'
import { DefaultCoAuthorAgent } from '../agents/defaultAgent.js'
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
 * - agent: Agent implementation
 * - agentRuntime: Agent orchestration
 */
export type App = {
  baseDir: string
  storePath: string
  auditLogPath: string
  conversationsPath: string
  
  // Infrastructure
  store: EventStore
  auditLog: AuditLog
  conversationStore: ConversationStore
  telemetry: TelemetrySink
  toolRegistry: ToolRegistry
  toolExecutor: ToolExecutor
  llm: LLMClient
  
  // Application Services
  taskService: TaskService
  eventService: EventService
  interactionService: InteractionService
  auditService: AuditService
  contextBuilder: ContextBuilder
  
  // Agent
  agent: Agent
  agentRuntime: AgentRuntime
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
export function createApp(opts: CreateAppOptions): App {
  const baseDir = opts.baseDir
  const currentActorId = opts.currentActorId ?? DEFAULT_USER_ACTOR_ID
  const config = opts.config ?? loadAppConfig(process.env)

  // === Infrastructure Layer ===
  
  // Event Store (User ↔ Agent decisions)
  const eventsPath = opts.eventsPath ?? join(baseDir, '.coauthor', 'events.jsonl')
  const store = new JsonlEventStore({ eventsPath, projectionsPath: opts.projectionsPath })
  store.ensureSchema()

  // Audit Log (Agent ↔ Tools/Files)
  const auditLogPath = opts.auditLogPath ?? join(baseDir, '.coauthor', 'audit.jsonl')
  const auditLog = new JsonlAuditLog({ auditPath: auditLogPath })
  auditLog.ensureSchema()

  // Conversation Store (Agent ↔ LLM context persistence)
  const conversationsPath = opts.conversationsPath ?? join(baseDir, '.coauthor', 'conversations.jsonl')
  const conversationStore = opts.conversationStore ?? new JsonlConversationStore({ conversationsPath })
  if (!opts.conversationStore) {
    conversationStore.ensureSchema()
  }

  // Tool Registry
  const toolRegistry = opts.toolRegistry ?? new DefaultToolRegistry()
  if (!opts.toolRegistry) {
    registerBuiltinTools(toolRegistry as DefaultToolRegistry)
  }

  // Tool Executor
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })

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
  
  const taskService = new TaskService(store, currentActorId)
  const eventService = new EventService(store)
  const interactionService = new InteractionService(store, currentActorId)
  const auditService = new AuditService(auditLog)
  const contextBuilder = new ContextBuilder(baseDir)

  // === Agent Layer ===
  
  const agent = opts.agent ?? new DefaultCoAuthorAgent({ contextBuilder })

  const agentRuntime = new AgentRuntime({
    store,
    conversationStore,
    auditLog,
    telemetry,
    taskService,
    interactionService,
    agent,
    llm,
    toolRegistry,
    toolExecutor,
    baseDir
  })

  return {
    baseDir,
    storePath: eventsPath,
    auditLogPath,
    conversationsPath,
    // Infrastructure
    store,
    auditLog,
    conversationStore,
    telemetry,
    toolRegistry,
    toolExecutor,
    llm,
    // Application Services
    taskService,
    eventService,
    interactionService,
    auditService,
    contextBuilder,
    // Agent
    agent,
    agentRuntime
  }
}
