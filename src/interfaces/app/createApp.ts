import { join, resolve } from 'node:path'
import type { EventStore } from '../../core/ports/eventStore.js'
import type { ArtifactStore } from '../../core/ports/artifactStore.js'
import type { ToolRegistry, ToolExecutor } from '../../core/ports/tool.js'
import type { AuditLog } from '../../core/ports/auditLog.js'
import type { ConversationStore } from '../../core/ports/conversationStore.js'
import type { LLMClient } from '../../core/ports/llmClient.js'
import type { UiBus } from '../../core/ports/uiBus.js'
import type { SkillSessionManager } from '../../core/ports/skill.js'
import type { Subscription } from '../../core/ports/subscribable.js'
import type { Agent } from '../../agents/core/agent.js'
import { RuntimeManager } from '../../agents/orchestration/runtimeManager.js'
import { JsonlEventStore } from '../../infrastructure/persistence/jsonlEventStore.js'
import { FsArtifactStore } from '../../infrastructure/filesystem/fsArtifactStore.js'
import { JsonlAuditLog } from '../../infrastructure/persistence/jsonlAuditLog.js'
import { JsonlConversationStore } from '../../infrastructure/persistence/jsonlConversationStore.js'
import { ExtendedToolRegistry } from '../../infrastructure/tools/extendedToolRegistry.js'
import { registerBuiltinTools } from '../../infrastructure/tools/index.js'
import { registerAgentGroupTools } from '../../infrastructure/tools/agentGroupTools.js'
import { registerTodoUpdateTool } from '../../infrastructure/tools/todoUpdate.js'
import { registerActivateSkillTool } from '../../infrastructure/tools/activateSkill.js'
import { DefaultToolExecutor } from '../../infrastructure/tools/toolExecutor.js'
import { McpToolExtensionManager } from '../../infrastructure/tools/mcpClient.js'
import { DefaultSkillRegistry } from '../../infrastructure/skills/skillRegistry.js'
import { SkillManager } from '../../infrastructure/skills/skillManager.js'
import { DefaultWorkspacePathResolver } from '../../infrastructure/workspace/workspacePathResolver.js'
import { WorkspaceDirectoryProvisioner } from '../../infrastructure/workspace/workspaceDirectoryProvisioner.js'
import { createUiBus } from '../../infrastructure/subjectUiBus.js'
import { TaskService, EventService, InteractionService, AuditService } from '../../application/index.js'
import { ContextBuilder } from '../../application/context/contextBuilder.js'
import { ConversationManager } from '../../agents/orchestration/conversationManager.js'
import { OutputHandler } from '../../agents/orchestration/outputHandler.js'
import { DefaultSeedAgent } from '../../agents/implementations/defaultAgent.js'
import { SearchAgent } from '../../agents/implementations/searchAgent.js'
import { MinimalAgent } from '../../agents/implementations/minimalAgent.js'
import { createLLMClient } from '../../infrastructure/llm/createLLMClient.js'
import { DEFAULT_USER_ACTOR_ID } from '../../core/entities/actor.js'
import { loadAppConfig, type AppConfig } from '../../config/appConfig.js'
import { ConsoleTelemetrySink, NoopTelemetrySink, type TelemetrySink } from '../../core/ports/telemetry.js'

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
  mcpToolExtension: McpToolExtensionManager | null
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

  // Lifecycle
  dispose: () => Promise<void>
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
  const config = opts.config ?? loadAppConfig(process.env, { workspaceDir: baseDir })
  const llm = opts.llm ?? createLLMClient(config)

  // === Infrastructure Layer ===
  
  // Event Store (User ↔ Agent decisions)
  const eventsPath = opts.eventsPath ?? join(baseDir, 'state', 'events.jsonl')
  const store = new JsonlEventStore({ eventsPath, projectionsPath: opts.projectionsPath })
  await store.ensureSchema()

  // Artifact Store (File access)
  const artifactStore = new FsArtifactStore(baseDir)

  // Audit Log (Agent ↔ Tools/Files)
  const auditLogPath = opts.auditLogPath ?? join(baseDir, 'state', 'audit.jsonl')
  const auditLog = new JsonlAuditLog({ auditPath: auditLogPath })
  await auditLog.ensureSchema()

  // Conversation Store (Agent ↔ LLM context persistence)
  const conversationsPath = opts.conversationsPath ?? join(baseDir, 'state', 'conversations.jsonl')
  const conversationStore = opts.conversationStore ?? new JsonlConversationStore({ conversationsPath })
  if (!opts.conversationStore) {
    await conversationStore.ensureSchema()
  }

  // Tool Registry
  const toolRegistry = opts.toolRegistry ?? new ExtendedToolRegistry()
  if (!opts.toolRegistry) {
    registerBuiltinTools(toolRegistry, {
      runCommand: {
        maxOutputLength: config.resources.maxOutputLength,
        defaultTimeout: config.timeouts.exec
      },
      web: {
        llm,
        profile: 'research_web',
      },
    })
  }

  let mcpToolExtension: McpToolExtensionManager | null = null
  if (!opts.toolRegistry && toolRegistry instanceof ExtendedToolRegistry) {
    mcpToolExtension = new McpToolExtensionManager({
      config: config.mcp,
      onToolsChanged: (namespace, tools) => {
        toolRegistry.setDynamicTools(namespace, tools)
      },
    })
    await mcpToolExtension.start()
  }

  // Tool Executor
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })

  // Skill Registry + Manager (workspace-local skills)
  const skillRegistry = new DefaultSkillRegistry()
  const concreteSkillManager = new SkillManager({
    baseDir,
    registry: skillRegistry,
  })
  const skillManager: SkillSessionManager = concreteSkillManager
  const discoveredSkills = await concreteSkillManager.discoverWorkspaceSkills()
  for (const warning of discoveredSkills.warnings) {
    console.warn(warning)
  }
  if (discoveredSkills.loaded > 0) {
    registerActivateSkillTool(toolRegistry, { skillManager })
  }

  const uiBus = createUiBus()
  const auditEntrySubscription: Subscription = auditLog.entries$.subscribe((entry) => {
    uiBus.emit({ type: 'audit_entry', payload: entry })
  })

  const telemetry: TelemetrySink =
    config.telemetry.sink === 'console' ? new ConsoleTelemetrySink() : new NoopTelemetrySink()

  // === Application Layer ===
  
  const taskService = new TaskService(store, currentActorId, config.task.defaultPriority)
  const workspaceResolver = new DefaultWorkspacePathResolver({
    baseDir,
    taskService
  })
  // Auto-provision scoped workspace roots as tasks/groups become active.
  const workspaceDirectoryProvisioner = new WorkspaceDirectoryProvisioner({
    store,
    workspaceResolver
  })
  workspaceDirectoryProvisioner.start()
  const eventService = new EventService(store)
  const interactionService = new InteractionService(store, currentActorId, config.timeouts.interaction)
  const auditService = new AuditService(auditLog, config.resources.auditLogLimit)
  const contextBuilder = new ContextBuilder(baseDir, artifactStore)

  // === Agent Layer ===
  
  const defaultAgent = opts.agent ?? new DefaultSeedAgent({
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
    workspaceResolver,
    telemetry
  })

  const outputHandler = new OutputHandler({
    toolExecutor,
    toolRegistry,
    artifactStore,
    workspaceResolver,
    uiBus,
    conversationManager,
    telemetry
  })

  const runtimeManager = new RuntimeManager({
    store,
    taskService,
    llm,
    toolRegistry,
    skillRegistry,
    skillManager,
    baseDir,
    conversationManager,
    outputHandler
  })
  runtimeManager.registerAgent(defaultAgent)
  runtimeManager.registerAgent(searchAgent)
  runtimeManager.registerAgent(minimalAgent)

  // Register top-level agent-group management tools.
  registerTodoUpdateTool(toolRegistry, { taskService })

  // Register top-level agent-group management tools.
  registerAgentGroupTools(toolRegistry, {
    store,
    taskService,
    conversationStore,
    runtimeManager
  })

  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true

    runtimeManager.stop()
    workspaceDirectoryProvisioner.stop()
    auditEntrySubscription.unsubscribe()
    await mcpToolExtension?.stop()
  }

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
    mcpToolExtension,
    llm,
    uiBus,
    // Application Services
    taskService,
    eventService,
    interactionService,
    auditService,
    contextBuilder,
    // Agent
    runtimeManager,
    // Lifecycle
    dispose
  }
}
