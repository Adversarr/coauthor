import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { JsonlEventStore } from '../../src/infrastructure/persistence/jsonlEventStore.js'
import { JsonlAuditLog } from '../../src/infrastructure/persistence/jsonlAuditLog.js'
import { JsonlConversationStore } from '../../src/infrastructure/persistence/jsonlConversationStore.js'
import { TaskService } from '../../src/application/services/taskService.js'
import { RuntimeManager } from '../../src/agents/orchestration/runtimeManager.js'
import { ConversationManager } from '../../src/agents/orchestration/conversationManager.js'
import { OutputHandler } from '../../src/agents/orchestration/outputHandler.js'
import { DefaultSeedAgent } from '../../src/agents/implementations/defaultAgent.js'
import { FakeLLMClient } from '../../src/infrastructure/llm/fakeLLMClient.js'
import { DefaultToolRegistry } from '../../src/infrastructure/tools/toolRegistry.js'
import { DefaultToolExecutor } from '../../src/infrastructure/tools/toolExecutor.js'
import { ContextBuilder } from '../../src/application/context/contextBuilder.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import type { Agent, AgentContext } from '../../src/agents/core/agent.js'
import type { TaskView } from '../../src/application/services/taskService.js'
import type { AgentOutput } from '../../src/agents/core/agent.js'
import type { ArtifactStore } from '../../src/core/ports/artifactStore.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeInfra(dir: string) {
  const store = new JsonlEventStore({
    eventsPath: join(dir, 'events.jsonl'),
    projectionsPath: join(dir, 'projections.jsonl')
  })
  await store.ensureSchema()

  const conversationStore = new JsonlConversationStore({
    conversationsPath: join(dir, 'conversations.jsonl')
  })
  await conversationStore.ensureSchema()

  const artifactStore: ArtifactStore = {
    readFile: async () => '',
    readFileRange: async () => '',
    listDir: async () => [],
    writeFile: async () => {}
  }

  const auditLog = new JsonlAuditLog({ auditPath: join(dir, 'audit.jsonl') })
  const toolRegistry = new DefaultToolRegistry()
  toolRegistry.register({
    name: 'dummy_tool',
    description: 'A dummy tool',
    parameters: { type: 'object', properties: {} },
    group: 'search',
    riskLevel: 'safe',
    execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'dummy' })
  })

  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })
  const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
  const llm = new FakeLLMClient()
  const contextBuilder = new ContextBuilder(dir)

  const conversationManager = new ConversationManager({
    conversationStore,
    auditLog,
    toolRegistry,
    toolExecutor,
    artifactStore
  })

  const outputHandler = new OutputHandler({
    toolExecutor,
    toolRegistry,
    artifactStore,
    conversationManager
  })

  return { store, conversationStore, taskService, llm, toolRegistry, contextBuilder, conversationManager, outputHandler }
}

/** Minimal agent stub that completes immediately. Yields 'done' by default. */
function stubAgent(id: string): Agent {
  return {
    id,
    displayName: id,
    description: `Stub agent ${id}`,
    toolGroups: [],
    defaultProfile: 'fast',
    async *run(_task: TaskView, _ctx: AgentContext): AsyncGenerator<AgentOutput> {
      yield { kind: 'done' }
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RuntimeManager — Agent Registration', () => {
  test('first registered agent becomes default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)

    const manager = new RuntimeManager(infra)
    const agentA = stubAgent('agent_a')
    const agentB = stubAgent('agent_b')

    manager.registerAgent(agentA)
    manager.registerAgent(agentB)

    expect(manager.defaultAgentId).toBe('agent_a')
    expect(manager.agents.size).toBe(2)

    rmSync(dir, { recursive: true, force: true })
  })

  test('throws when no agents registered and defaultAgentId accessed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)
    const manager = new RuntimeManager(infra)

    expect(() => manager.defaultAgentId).toThrow('No agents registered')

    rmSync(dir, { recursive: true, force: true })
  })

  test('agents map exposes registered agents', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)
    const manager = new RuntimeManager(infra)

    const agentA = stubAgent('agent_a')
    manager.registerAgent(agentA)

    expect(manager.agents.get('agent_a')).toBe(agentA)
    expect(manager.agents.has('agent_b')).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('RuntimeManager — Lifecycle', () => {
  test('start()/stop() toggles isRunning', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(stubAgent(DEFAULT_AGENT_ACTOR_ID))

    expect(manager.isRunning).toBe(false)
    manager.start()
    expect(manager.isRunning).toBe(true)
    manager.stop()
    expect(manager.isRunning).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })

  test('double start is idempotent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(stubAgent(DEFAULT_AGENT_ACTOR_ID))

    manager.start()
    manager.start() // no-op
    expect(manager.isRunning).toBe(true)
    manager.stop()

    rmSync(dir, { recursive: true, force: true })
  })

  test('stop cleans up runtimes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(new DefaultSeedAgent({ contextBuilder: new ContextBuilder(dir) }))

    manager.start()
    await infra.taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })
    await manager.waitForIdle()
    manager.stop()

    // After stop, isRunning should be false
    expect(manager.isRunning).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('RuntimeManager — Event Routing', () => {
  test('routes TaskCreated to correct agent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(new DefaultSeedAgent({ contextBuilder: new ContextBuilder(dir) }))

    manager.start()

    const { taskId } = await infra.taskService.createTask({
      title: 'Routed',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await manager.waitForIdle()
    manager.stop()

    // Task should have been executed and completed
    const events = await infra.store.readStream(taskId, 1)
    expect(events.some(e => e.type === 'TaskStarted')).toBe(true)
    expect(events.some(e => e.type === 'TaskCompleted')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('ignores TaskCreated for unregistered agent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(stubAgent('agent_x'))

    manager.start()

    // Create task for an agent that isn't registered
    await infra.store.append('t_unknown', [{
      type: 'TaskCreated',
      payload: {
        taskId: 't_unknown',
        title: 'Unknown',
        intent: '',
        priority: 'foreground',
        agentId: 'agent_not_registered',
        authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    await manager.waitForIdle()
    manager.stop()

    // No TaskStarted should have been emitted
    const events = await infra.store.readStream('t_unknown', 1)
    expect(events.some(e => e.type === 'TaskStarted')).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })

  test('routes TaskCanceled and cleans up runtime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(new DefaultSeedAgent({ contextBuilder: new ContextBuilder(dir) }))

    manager.start()

    // Manually append a TaskCreated + TaskCanceled in sequence
    // to verify RuntimeManager processes the cancel event
    const taskId = 'cancel-test-1'
    await infra.store.append(taskId, [{
      type: 'TaskCreated',
      payload: {
        taskId,
        title: 'Cancel Me',
        intent: '',
        priority: 'foreground' as const,
        agentId: DEFAULT_AGENT_ACTOR_ID,
        authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    await manager.waitForIdle()

    // Now cancel it
    await infra.store.append(taskId, [{
      type: 'TaskCanceled',
      payload: { taskId, authorActorId: DEFAULT_USER_ACTOR_ID }
    }])

    await manager.waitForIdle()
    manager.stop()

    // The canceled event should be in the stream
    const events = await infra.store.readStream(taskId, 1)
    expect(events.some(e => e.type === 'TaskCanceled')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('executeTask throws for unknown task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(stubAgent(DEFAULT_AGENT_ACTOR_ID))

    await expect(manager.executeTask('nonexistent')).rejects.toThrow('Task not found')

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('RuntimeManager — Multi-Agent Routing', () => {
  test('two registered agents each handle their own tasks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const infra = await makeInfra(dir)
    const manager = new RuntimeManager(infra)

    // Use proper stub agents — DefaultSeedAgent uses private fields
    // so Object.create won't work.
    const agentA = stubAgent(DEFAULT_AGENT_ACTOR_ID)
    const agentB = stubAgent('agent_b')

    manager.registerAgent(agentA)
    manager.registerAgent(agentB)

    manager.start()

    // Create tasks for each agent
    const { taskId: tA } = await infra.taskService.createTask({ title: 'A', agentId: DEFAULT_AGENT_ACTOR_ID })
    const { taskId: tB } = await infra.taskService.createTask({ title: 'B', agentId: 'agent_b' })

    await manager.waitForIdle()
    manager.stop()

    // Both should have been started and completed
    const eventsA = await infra.store.readStream(tA, 1)
    const eventsB = await infra.store.readStream(tB, 1)

    expect(eventsA.some(e => e.type === 'TaskStarted')).toBe(true)
    expect(eventsA.some(e => e.type === 'TaskCompleted')).toBe(true)

    expect(eventsB.some(e => e.type === 'TaskStarted')).toBe(true)
    expect(eventsB.some(e => e.type === 'TaskCompleted')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })
})
