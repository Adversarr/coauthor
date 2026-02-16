/**
 * Tests for the SubAgent / SubTask feature.
 *
 * Covers:
 * - Projection: parentTaskId, childTaskIds, summary, failureReason
 * - Subtask tool: happy path, child failure, cascade cancel, depth limit
 * - Blocking across UIP
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { Subject } from 'rxjs'
import { JsonlEventStore } from '../src/infrastructure/persistence/jsonlEventStore.js'
import { JsonlAuditLog } from '../src/infrastructure/persistence/jsonlAuditLog.js'
import { JsonlConversationStore } from '../src/infrastructure/persistence/jsonlConversationStore.js'
import { TaskService } from '../src/application/services/taskService.js'
import { RuntimeManager } from '../src/agents/orchestration/runtimeManager.js'
import { ConversationManager } from '../src/agents/orchestration/conversationManager.js'
import { OutputHandler } from '../src/agents/orchestration/outputHandler.js'
import { FakeLLMClient } from '../src/infrastructure/llm/fakeLLMClient.js'
import { DefaultToolRegistry } from '../src/infrastructure/tools/toolRegistry.js'
import { DefaultToolExecutor } from '../src/infrastructure/tools/toolExecutor.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../src/core/entities/actor.js'
import { createSubtaskTool, registerSubtaskTools } from '../src/infrastructure/tools/createSubtaskTool.js'
import type { Agent, AgentOutput } from '../src/agents/core/agent.js'
import type { DomainEvent, StoredEvent, EventStore } from '../src/core/index.js'
import type { ArtifactStore } from '../src/core/ports/artifactStore.js'

// ============================================================================
// In-Memory EventStore (from existing test pattern)
// ============================================================================

class InMemoryEventStore implements EventStore {
  private events: StoredEvent[] = []
  public events$ = new Subject<StoredEvent>()

  async ensureSchema(): Promise<void> {}

  async append(streamId: string, events: DomainEvent[]): Promise<StoredEvent[]> {
    const currentStreamEvents = this.events.filter(ev => ev.streamId === streamId)
    const newStoredEvents = events.map((e, i) => ({
      id: this.events.length + i + 1,
      streamId,
      seq: currentStreamEvents.length + i + 1,
      ...e,
      createdAt: new Date().toISOString()
    })) as StoredEvent[]
    this.events.push(...newStoredEvents)
    newStoredEvents.forEach(e => this.events$.next(e))
    return newStoredEvents
  }

  async readStream(streamId: string): Promise<StoredEvent[]> {
    return this.events.filter(e => e.streamId === streamId)
  }

  async readAll(fromIdExclusive?: number): Promise<StoredEvent[]> {
    const startId = fromIdExclusive ?? 0
    return this.events.filter(e => e.id > startId)
  }

  async readById(id: number): Promise<StoredEvent | null> {
    return this.events.find(e => e.id === id) || null
  }

  async getProjection<TState>(name: string, defaultState: TState): Promise<{ cursorEventId: number; state: TState }> {
    return { cursorEventId: 0, state: defaultState }
  }

  async saveProjection(): Promise<void> {}
}

// ============================================================================
// Helpers
// ============================================================================

const mockArtifactStore: ArtifactStore = {
  readFile: async () => '',
  readFileRange: async () => '',
  listDir: async () => [],
  writeFile: async () => {},
  exists: async () => false,
  mkdir: async () => {},
  stat: async () => null
}

// ============================================================================
// Projection Tests
// ============================================================================

describe('TaskService projection — subtask fields', () => {
  test('parentTaskId is stored on child and childTaskIds on parent', async () => {
    const store = new InMemoryEventStore()
    const svc = new TaskService(store as unknown as EventStore, DEFAULT_USER_ACTOR_ID)

    // Create parent
    await store.append('parent1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 'parent1', title: 'Parent', intent: '', priority: 'foreground',
        agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    // Create child with parentTaskId
    await store.append('child1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 'child1', title: 'Child', intent: '', priority: 'normal',
        agentId: DEFAULT_AGENT_ACTOR_ID, parentTaskId: 'parent1',
        authorActorId: DEFAULT_AGENT_ACTOR_ID
      }
    }])

    const state = await svc.listTasks()
    const parent = state.tasks.find(t => t.taskId === 'parent1')!
    const child = state.tasks.find(t => t.taskId === 'child1')!

    expect(child.parentTaskId).toBe('parent1')
    expect(parent.childTaskIds).toEqual(['child1'])
  })

  test('childTaskIds are idempotent on duplicate events', async () => {
    const store = new InMemoryEventStore()
    const svc = new TaskService(store as unknown as EventStore, DEFAULT_USER_ACTOR_ID)

    await store.append('parent1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 'parent1', title: 'Parent', intent: '', priority: 'foreground',
        agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])

    await store.append('child1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 'child1', title: 'Child', intent: '', priority: 'normal',
        agentId: DEFAULT_AGENT_ACTOR_ID, parentTaskId: 'parent1',
        authorActorId: DEFAULT_AGENT_ACTOR_ID
      }
    }])

    await store.append('child2', [{
      type: 'TaskCreated',
      payload: {
        taskId: 'child2', title: 'Child 2', intent: '', priority: 'normal',
        agentId: DEFAULT_AGENT_ACTOR_ID, parentTaskId: 'parent1',
        authorActorId: DEFAULT_AGENT_ACTOR_ID
      }
    }])

    const state = await svc.listTasks()
    const parent = state.tasks.find(t => t.taskId === 'parent1')!
    expect(parent.childTaskIds).toEqual(['child1', 'child2'])
  })

  test('summary stored on TaskCompleted', async () => {
    const store = new InMemoryEventStore()
    const svc = new TaskService(store as unknown as EventStore, DEFAULT_USER_ACTOR_ID)

    await store.append('t1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 't1', title: 'Task', intent: '', priority: 'foreground',
        agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])
    await store.append('t1', [{
      type: 'TaskStarted',
      payload: { taskId: 't1', agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])
    await store.append('t1', [{
      type: 'TaskCompleted',
      payload: { taskId: 't1', summary: 'All done!', authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])

    const task = await svc.getTask('t1')
    expect(task?.status).toBe('done')
    expect(task?.summary).toBe('All done!')
  })

  test('failureReason stored on TaskFailed', async () => {
    const store = new InMemoryEventStore()
    const svc = new TaskService(store as unknown as EventStore, DEFAULT_USER_ACTOR_ID)

    await store.append('t1', [{
      type: 'TaskCreated',
      payload: {
        taskId: 't1', title: 'Task', intent: '', priority: 'foreground',
        agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }])
    await store.append('t1', [{
      type: 'TaskStarted',
      payload: { taskId: 't1', agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])
    await store.append('t1', [{
      type: 'TaskFailed',
      payload: { taskId: 't1', reason: 'Something broke', authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])

    const task = await svc.getTask('t1')
    expect(task?.status).toBe('failed')
    expect(task?.failureReason).toBe('Something broke')
  })

  test('createTask with parentTaskId and authorActorId override', async () => {
    const store = new InMemoryEventStore()
    const svc = new TaskService(store as unknown as EventStore, DEFAULT_USER_ACTOR_ID)

    // Create parent
    await svc.createTask({ title: 'Parent', agentId: DEFAULT_AGENT_ACTOR_ID })

    const state1 = await svc.listTasks()
    const parentId = state1.tasks[0]!.taskId

    // Create child with overrides
    const { taskId: childId } = await svc.createTask({
      title: 'Child',
      agentId: DEFAULT_AGENT_ACTOR_ID,
      parentTaskId: parentId,
      authorActorId: DEFAULT_AGENT_ACTOR_ID
    })

    const state2 = await svc.listTasks()
    const parent = state2.tasks.find(t => t.taskId === parentId)!
    const child = state2.tasks.find(t => t.taskId === childId)!

    expect(child.parentTaskId).toBe(parentId)
    expect(child.createdBy).toBe(DEFAULT_AGENT_ACTOR_ID)
    expect(parent.childTaskIds).toContain(childId)
  })
})

// ============================================================================
// Subtask Tool Tests (unit level, using InMemoryEventStore)
// ============================================================================

describe('createSubtaskTool', () => {
  /** A simple agent that immediately completes with a summary. */
  const completingAgent: Agent = {
    id: 'agent_completer',
    displayName: 'Completer',
    description: 'Test agent that completes and returns a summary.',
    toolGroups: [],
    defaultProfile: 'fast',
    async *run(task, _context) {
      yield { kind: 'done', summary: `Completed subtask: ${task.title}` } as AgentOutput
    }
  }

  /** An agent that immediately fails. */
  const failingAgent: Agent = {
    id: 'agent_failer',
    displayName: 'Failer',
    description: 'Test agent that fails intentionally.',
    toolGroups: [],
    defaultProfile: 'fast',
    async *run(_task, _context) {
      yield { kind: 'failed', reason: 'Intentional failure' } as AgentOutput
    }
  }

  async function createIntegrationEnv(agents: Agent[]) {
    const dir = mkdtempSync(join(tmpdir(), 'seed-subtask-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    await store.ensureSchema()

    const conversationStore = new JsonlConversationStore({
      conversationsPath: join(dir, 'conversations.jsonl')
    })
    await conversationStore.ensureSchema()

    const auditLog = new JsonlAuditLog({ auditPath: join(dir, 'audit.jsonl') })
    const toolRegistry = new DefaultToolRegistry()
    const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const llm = new FakeLLMClient()
    const conversationManager = new ConversationManager({
      conversationStore,
      auditLog,
      toolRegistry,
      toolExecutor,
      artifactStore: mockArtifactStore
    })

    const outputHandler = new OutputHandler({
      toolExecutor,
      toolRegistry,
      artifactStore: mockArtifactStore,
      conversationManager
    })

    const runtimeManager = new RuntimeManager({
      store,
      taskService,
      llm,
      toolRegistry,
      baseDir: dir,
      conversationManager,
      outputHandler
    })

    for (const agent of agents) {
      runtimeManager.registerAgent(agent)
    }

    // Register subtask tools for all agents
    registerSubtaskTools(toolRegistry, {
      store,
      taskService,
      conversationStore,
      runtimeManager,
      maxSubtaskDepth: 3
    })

    return { dir, store, conversationStore, taskService, runtimeManager, toolRegistry }
  }

  test('returns Success when child completes', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent])

    runtimeManager.start()
    try {
      // Create parent task
      await taskService.createTask({
        title: 'Parent task', agentId: completingAgent.id
      })

      // Wait for parent to complete (agent auto-completes)
      await runtimeManager.waitForIdle()

      // Now test the subtask tool directly
      const tool = toolRegistry.get(`create_subtask_${completingAgent.id}`)!
      expect(tool).toBeDefined()
      expect(tool.name).toBe(`create_subtask_${completingAgent.id}`)
      expect(tool.riskLevel).toBe('safe')

      // Create a second parent to test the tool
      const { taskId: parent2Id } = await taskService.createTask({
        title: 'Parent 2', agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      // Execute tool as if called by parent2
      const result = await tool.execute(
        { title: 'My subtask', intent: 'Do something' },
        {
          taskId: parent2Id,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      // Wait for child to be processed
      await runtimeManager.waitForIdle()

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output as string)
      expect(parsed.subTaskStatus).toBe('Success')
      expect(parsed.summary).toContain('Completed subtask')
      expect(parsed.agentId).toBe(completingAgent.id)
    } finally {
      runtimeManager.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns Error when child fails', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent, failingAgent])

    runtimeManager.start()
    try {
      // Create a parent task (use completingAgent)
      const { taskId: parentId } = await taskService.createTask({
        title: 'Parent', agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      // Execute subtask tool targeting failing agent
      const tool = toolRegistry.get(`create_subtask_${failingAgent.id}`)!
      expect(tool).toBeDefined()

      const result = await tool.execute(
        { title: 'Doomed subtask' },
        {
          taskId: parentId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      await runtimeManager.waitForIdle()

      expect(result.isError).toBe(true)
      const parsed = JSON.parse(result.output as string)
      expect(parsed.subTaskStatus).toBe('Error')
      expect(parsed.failureReason).toBe('Intentional failure')
    } finally {
      runtimeManager.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects when max depth exceeded', async () => {
    const { dir, store, conversationStore, taskService, runtimeManager } = await createIntegrationEnv([completingAgent])

    // Override with max depth 0 to test limit
    // Create a custom tool with maxSubtaskDepth=0
    const shallowTool = createSubtaskTool(completingAgent.id, completingAgent.displayName, completingAgent.description, {
      store,
      taskService,
      conversationStore,
      runtimeManager,
      maxSubtaskDepth: 0  // Effectively disallows any subtasks
    })

    runtimeManager.start()
    try {
      const { taskId: parentId } = await taskService.createTask({
        title: 'Parent', agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      const result = await shallowTool.execute(
        { title: 'Too deep' },
        {
          taskId: parentId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      expect(result.isError).toBe(true)
      const parsed = JSON.parse(result.output as string)
      expect(parsed.error).toContain('Maximum subtask nesting depth')
    } finally {
      runtimeManager.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('cascade cancel via AbortSignal', async () => {
    /** Agent that takes forever (blocked subtask). */
    const slowAgent: Agent = {
      id: 'agent_slow',
      displayName: 'Slow',
      description: 'Test agent that blocks indefinitely.',
      toolGroups: [],
      defaultProfile: 'fast',
      async *run() {
        // Yield nothing and never complete — simulate a long-running task
        await new Promise(() => {})
      }
    }

    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent, slowAgent])

    runtimeManager.start()
    try {
      const { taskId: parentId } = await taskService.createTask({
        title: 'Parent', agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      const tool = toolRegistry.get(`create_subtask_${slowAgent.id}`)!
      const controller = new AbortController()

      // Start execution in background
      const resultPromise = tool.execute(
        { title: 'Slow subtask' },
        {
          taskId: parentId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore,
          signal: controller.signal
        }
      )

      // Give it a tick to create the child task
      await new Promise(resolve => setTimeout(resolve, 50))

      // Abort (simulates parent cancel)
      controller.abort()

      const result = await resultPromise
      const parsed = JSON.parse(result.output as string)
      expect(parsed.subTaskStatus).toBe('Cancel')
      expect(parsed.failureReason).toContain('canceled or paused')
    } finally {
      runtimeManager.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('tool has correct parameter schema', async () => {
    const { dir, toolRegistry } = await createIntegrationEnv([completingAgent])
    try {
      const tool = toolRegistry.get(`create_subtask_${completingAgent.id}`)!
      expect(tool.parameters.type).toBe('object')
      expect(tool.parameters.required).toEqual(['title'])
      expect(tool.parameters.properties).toHaveProperty('title')
      expect(tool.parameters.properties).toHaveProperty('intent')
      expect(tool.parameters.properties).toHaveProperty('priority')
      expect(tool.parameters.properties.priority?.enum).toEqual(['foreground', 'normal', 'background'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns Cancel when child is externally canceled', async () => {
    /** An agent that never completes — blocks forever. */
    const blockingAgent: Agent = {
      id: 'agent_blocker',
      displayName: 'Blocker',
      description: 'Test agent that never completes.',
      toolGroups: [],
      defaultProfile: 'fast',
      async *run() {
        await new Promise(() => {}) // never resolves
      }
    }

    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent, blockingAgent])

    runtimeManager.start()
    try {
      // Create parent task that completes immediately
      const { taskId: parentId } = await taskService.createTask({
        title: 'Parent', agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      const tool = toolRegistry.get(`create_subtask_${blockingAgent.id}`)!

      // Start subtask in background
      const resultPromise = tool.execute(
        { title: 'Will be canceled' },
        {
          taskId: parentId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      // Wait for child task to be created
      await new Promise(resolve => setTimeout(resolve, 50))

      // Find the child task and cancel it externally
      const state = await taskService.listTasks()
      const childTask = state.tasks.find(t => t.parentTaskId === parentId && t.title === 'Will be canceled')
      expect(childTask).toBeDefined()

      // Cancel child (emit TaskCanceled)
      await taskService.cancelTask(childTask!.taskId, 'External cancel')

      const result = await resultPromise
      const parsed = JSON.parse(result.output as string)
      expect(parsed.subTaskStatus).toBe('Cancel')
      expect(parsed.failureReason).toContain('External cancel')
    } finally {
      runtimeManager.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns Cancel immediately when signal already aborted', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent])

    runtimeManager.start()
    try {
      const { taskId: parentId } = await taskService.createTask({
        title: 'Parent', agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      const tool = toolRegistry.get(`create_subtask_${completingAgent.id}`)!

      // Pre-aborted controller
      const controller = new AbortController()
      controller.abort()

      const result = await tool.execute(
        { title: 'Should not start' },
        {
          taskId: parentId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore,
          signal: controller.signal
        }
      )

      const parsed = JSON.parse(result.output as string)
      expect(parsed.subTaskStatus).toBe('Cancel')
      expect(parsed.failureReason).toContain('canceled or paused')
      // No child task should have been created
      const state = await taskService.listTasks()
      const children = state.tasks.filter(t => t.parentTaskId === parentId)
      expect(children.length).toBe(0)
    } finally {
      runtimeManager.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('auto-starts RuntimeManager when not running', async () => {
    const { dir, store, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent])

    // Do NOT call runtimeManager.start()
    expect(runtimeManager.isRunning).toBe(false)

    try {
      // Create parent manually (no runtime → it won't auto-execute)
      await store.append('manual-parent', [{
        type: 'TaskCreated',
        payload: {
          taskId: 'manual-parent',
          title: 'Manual parent',
          intent: '',
          priority: 'foreground' as const,
          agentId: completingAgent.id,
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }])

      const tool = toolRegistry.get(`create_subtask_${completingAgent.id}`)!

      // Execute: should return error since RuntimeManager not running (auto-start removed per RD-004)
      const result = await tool.execute(
        { title: 'Auto-start child' },
        {
          taskId: 'manual-parent',
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      // RuntimeManager should NOT be running (auto-start was removed)
      expect(runtimeManager.isRunning).toBe(false)

      const parsed = JSON.parse(result.output as string)
      expect(parsed.error).toBeDefined()
    } finally {
      runtimeManager.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
