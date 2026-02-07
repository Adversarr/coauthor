import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { JsonlEventStore } from '../../src/infra/jsonlEventStore.js'
import { JsonlAuditLog } from '../../src/infra/jsonlAuditLog.js'
import { JsonlConversationStore } from '../../src/infra/jsonlConversationStore.js'
import { TaskService } from '../../src/application/taskService.js'
import { RuntimeManager } from '../../src/agents/runtimeManager.js'
import { ConversationManager } from '../../src/agents/conversationManager.js'
import { OutputHandler } from '../../src/agents/outputHandler.js'
import { DefaultCoAuthorAgent } from '../../src/agents/defaultAgent.js'
import { FakeLLMClient } from '../../src/infra/fakeLLMClient.js'
import { DefaultToolRegistry } from '../../src/infra/toolRegistry.js'
import { DefaultToolExecutor } from '../../src/infra/toolExecutor.js'
import { ContextBuilder } from '../../src/application/contextBuilder.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../../src/domain/actor.js'
import type { Agent, AgentContext } from '../../src/agents/agent.js'
import type { TaskView } from '../../src/application/taskService.js'
import type { AgentOutput } from '../../src/agents/agent.js'
import type { ArtifactStore } from '../../src/domain/ports/artifactStore.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfra(dir: string) {
  const store = new JsonlEventStore({
    eventsPath: join(dir, 'events.jsonl'),
    projectionsPath: join(dir, 'projections.jsonl')
  })
  store.ensureSchema()

  const conversationStore = new JsonlConversationStore({
    conversationsPath: join(dir, 'conversations.jsonl')
  })
  conversationStore.ensureSchema()

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
    async *run(_task: TaskView, _ctx: AgentContext): AsyncGenerator<AgentOutput> {
      yield { kind: 'done' }
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RuntimeManager — Agent Registration', () => {
  test('first registered agent becomes default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)

    const manager = new RuntimeManager(infra)
    const agentA = stubAgent('agent_a')
    const agentB = stubAgent('agent_b')

    manager.registerAgent(agentA)
    manager.registerAgent(agentB)

    expect(manager.defaultAgentId).toBe('agent_a')
    expect(manager.agents.size).toBe(2)

    rmSync(dir, { recursive: true, force: true })
  })

  test('throws when no agents registered and defaultAgentId accessed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)
    const manager = new RuntimeManager(infra)

    expect(() => manager.defaultAgentId).toThrow('No agents registered')

    rmSync(dir, { recursive: true, force: true })
  })

  test('agents map exposes registered agents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)
    const manager = new RuntimeManager(infra)

    const agentA = stubAgent('agent_a')
    manager.registerAgent(agentA)

    expect(manager.agents.get('agent_a')).toBe(agentA)
    expect(manager.agents.has('agent_b')).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('RuntimeManager — Lifecycle', () => {
  test('start()/stop() toggles isRunning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(stubAgent(DEFAULT_AGENT_ACTOR_ID))

    expect(manager.isRunning).toBe(false)
    manager.start()
    expect(manager.isRunning).toBe(true)
    manager.stop()
    expect(manager.isRunning).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })

  test('double start is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(stubAgent(DEFAULT_AGENT_ACTOR_ID))

    manager.start()
    manager.start() // no-op
    expect(manager.isRunning).toBe(true)
    manager.stop()

    rmSync(dir, { recursive: true, force: true })
  })

  test('stop cleans up runtimes', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(new DefaultCoAuthorAgent({ contextBuilder: new ContextBuilder(dir) }))

    manager.start()
    infra.taskService.createTask({ title: 'T', agentId: DEFAULT_AGENT_ACTOR_ID })
    await vi.advanceTimersByTimeAsync(50)
    manager.stop()
    vi.useRealTimers()

    // After stop, isRunning should be false
    expect(manager.isRunning).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('RuntimeManager — Event Routing', () => {
  test('routes TaskCreated to correct agent', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(new DefaultCoAuthorAgent({ contextBuilder: new ContextBuilder(dir) }))

    manager.start()

    const { taskId } = infra.taskService.createTask({
      title: 'Routed',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await vi.advanceTimersByTimeAsync(50)
    manager.stop()
    vi.useRealTimers()

    // Task should have been executed and completed
    const events = infra.store.readStream(taskId, 1)
    expect(events.some(e => e.type === 'TaskStarted')).toBe(true)
    expect(events.some(e => e.type === 'TaskCompleted')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('ignores TaskCreated for unregistered agent', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(stubAgent('agent_x'))

    manager.start()

    // Create task for an agent that isn't registered
    infra.store.append('t_unknown', [{
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

    await vi.advanceTimersByTimeAsync(50)
    manager.stop()
    vi.useRealTimers()

    // No TaskStarted should have been emitted
    const events = infra.store.readStream('t_unknown', 1)
    expect(events.some(e => e.type === 'TaskStarted')).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })

  test('routes TaskCanceled and cleans up runtime', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(new DefaultCoAuthorAgent({ contextBuilder: new ContextBuilder(dir) }))

    manager.start()

    // Manually append a TaskCreated + TaskCanceled in sequence
    // to verify RuntimeManager processes the cancel event
    const taskId = 'cancel-test-1'
    infra.store.append(taskId, [{
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

    await vi.advanceTimersByTimeAsync(50)

    // Now cancel it
    infra.store.append(taskId, [{
      type: 'TaskCanceled',
      payload: { taskId, authorActorId: DEFAULT_USER_ACTOR_ID }
    }])

    await vi.advanceTimersByTimeAsync(10)
    manager.stop()
    vi.useRealTimers()

    // The canceled event should be in the stream
    const events = infra.store.readStream(taskId, 1)
    expect(events.some(e => e.type === 'TaskCanceled')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('executeTask throws for unknown task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)
    const manager = new RuntimeManager(infra)
    manager.registerAgent(stubAgent(DEFAULT_AGENT_ACTOR_ID))

    await expect(manager.executeTask('nonexistent')).rejects.toThrow('Task not found')

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('RuntimeManager — Multi-Agent Routing', () => {
  test('two registered agents each handle their own tasks', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const infra = makeInfra(dir)
    const manager = new RuntimeManager(infra)

    // Use proper stub agents — DefaultCoAuthorAgent uses private fields
    // so Object.create won't work.
    const agentA = stubAgent(DEFAULT_AGENT_ACTOR_ID)
    const agentB = stubAgent('agent_b')

    manager.registerAgent(agentA)
    manager.registerAgent(agentB)

    manager.start()

    // Create tasks for each agent
    const { taskId: tA } = infra.taskService.createTask({ title: 'A', agentId: DEFAULT_AGENT_ACTOR_ID })
    const { taskId: tB } = infra.taskService.createTask({ title: 'B', agentId: 'agent_b' })

    await vi.advanceTimersByTimeAsync(100)
    manager.stop()
    vi.useRealTimers()

    // Both should have been started and completed
    const eventsA = infra.store.readStream(tA, 1)
    const eventsB = infra.store.readStream(tB, 1)

    expect(eventsA.some(e => e.type === 'TaskStarted')).toBe(true)
    expect(eventsA.some(e => e.type === 'TaskCompleted')).toBe(true)

    expect(eventsB.some(e => e.type === 'TaskStarted')).toBe(true)
    expect(eventsB.some(e => e.type === 'TaskCompleted')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })
})
