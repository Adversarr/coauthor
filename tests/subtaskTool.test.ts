/**
 * Tests for task hierarchy projection and agent-group tools.
 *
 * Coverage:
 * - Projection model fields for parent/child linkage and terminal metadata.
 * - createSubtasks/listSubtask behavior and guards.
 * - Runtime-coupled wait/abort behavior for child task orchestration.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
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
import { registerAgentGroupTools } from '../src/infrastructure/tools/agentGroupTools.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from './helpers/actorIds.js'
import type { Agent, AgentOutput } from '../src/agents/core/agent.js'
import type { ArtifactStore } from '../src/core/ports/artifactStore.js'
import type { EventStore } from '../src/core/ports/eventStore.js'
import { InMemoryEventStore } from './helpers/inMemoryEventStore.js'

const mockArtifactStore: ArtifactStore = {
  readFile: async () => '',
  readFileRange: async () => '',
  listDir: async () => [],
  writeFile: async () => {},
  exists: async () => false,
  mkdir: async () => {},
  glob: async () => [],
  stat: async () => null
}

async function safeRemoveDir(dir: string): Promise<void> {
  const retries = 5
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === retries - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
  }
}

describe('TaskService projection — subtask fields', () => {
  test('parentTaskId is stored on child and childTaskIds on parent', async () => {
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

    const state = await svc.listTasks()
    const parent = state.tasks.find(t => t.taskId === 'parent1')!
    const child = state.tasks.find(t => t.taskId === 'child1')!

    expect(child.parentTaskId).toBe('parent1')
    expect(parent.childTaskIds).toEqual(['child1'])
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
})

describe('agentGroupTools', () => {
  const completingAgent: Agent = {
    id: 'agent_completer',
    displayName: 'Completer',
    description: 'Completes immediately with summary.',
    toolGroups: [],
    defaultProfile: 'fast',
    async *run(task) {
      yield { kind: 'done', summary: `Completed: ${task.title}` } as AgentOutput
    }
  }

  const failingAgent: Agent = {
    id: 'agent_failer',
    displayName: 'Failer',
    description: 'Fails immediately.',
    toolGroups: [],
    defaultProfile: 'fast',
    async *run() {
      yield { kind: 'failed', reason: 'Intentional failure' } as AgentOutput
    }
  }

  const slowAgent: Agent = {
    id: 'agent_slow',
    displayName: 'Slow',
    description: 'Never terminates unless canceled.',
    toolGroups: [],
    defaultProfile: 'fast',
    async *run() {
      await new Promise(() => {})
    }
  }

  async function createIntegrationEnv(agents: Agent[]) {
    const dir = mkdtempSync(join(tmpdir(), 'seed-agent-group-'))
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

    registerAgentGroupTools(toolRegistry, {
      store,
      taskService,
      conversationStore,
      runtimeManager
    })

    return { dir, store, conversationStore, taskService, runtimeManager, toolRegistry }
  }

  test('registers createSubtasks and listSubtask only (no dynamic create_subtask tools)', async () => {
    const { dir, toolRegistry } = await createIntegrationEnv([completingAgent, failingAgent])
    try {
      const names = toolRegistry.list().map((tool) => tool.name)
      expect(names).toContain('createSubtasks')
      expect(names).toContain('listSubtask')
      expect(names.some((name) => name.startsWith('create_subtask_'))).toBe(false)
    } finally {
      await safeRemoveDir(dir)
    }
  })

  test('createSubtasks rejects legacy wait argument', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent, failingAgent])
    runtimeManager.start()

    try {
      const { taskId: parentTaskId } = await taskService.createTask({
        title: 'Parent',
        agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      const tool = toolRegistry.get('createSubtasks')!
      const result = await tool.execute(
        {
          wait: 'none',
          tasks: [
            { agentId: completingAgent.id, title: 'Fast child' },
            { agentId: failingAgent.id, title: 'Failing child' }
          ]
        },
        {
          taskId: parentTaskId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      expect(result.isError).toBe(true)
      expect((result.output as any).error).toContain("no longer accepts 'wait'")

      const allTasks = (await taskService.listTasks()).tasks
      const children = allTasks.filter((task) => task.parentTaskId === parentTaskId)
      expect(children).toHaveLength(0)
    } finally {
      runtimeManager.stop()
      await safeRemoveDir(dir)
    }
  })

  test('createSubtasks waits and returns terminal outcomes for all children', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent, failingAgent])
    runtimeManager.start()

    try {
      const { taskId: parentTaskId } = await taskService.createTask({
        title: 'Parent',
        agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      const tool = toolRegistry.get('createSubtasks')!
      const result = await tool.execute(
        {
          tasks: [
            { agentId: completingAgent.id, title: 'Complete me' },
            { agentId: failingAgent.id, title: 'Fail me' }
          ]
        },
        {
          taskId: parentTaskId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      expect(result.isError).toBe(false)
      expect(result.toolCallId).toMatch(/^tool_/u)

      const parsed = result.output as any
      expect(parsed.tasks).toHaveLength(2)
      expect(parsed.summary.total).toBe(2)
      expect(parsed.summary.success).toBe(1)
      expect(parsed.summary.error).toBe(1)
      expect(parsed.summary.cancel).toBe(0)

      const statuses = parsed.tasks.map((task: any) => task.status).sort()
      expect(statuses).toEqual(['Error', 'Success'])
    } finally {
      runtimeManager.stop()
      await safeRemoveDir(dir)
    }
  })

  test('createSubtasks fails before creation when any agentId is invalid', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent, failingAgent])
    runtimeManager.start()

    try {
      const { taskId: parentTaskId } = await taskService.createTask({
        title: 'Parent',
        agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      const tool = toolRegistry.get('createSubtasks')!
      const result = await tool.execute(
        {
          tasks: [
            { agentId: completingAgent.id, title: 'Valid child' },
            { agentId: 'agent_missing', title: 'Invalid child' }
          ]
        },
        {
          taskId: parentTaskId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      expect(result.isError).toBe(true)
      expect((result.output as any).error).toContain('Unknown or unavailable agentId(s): agent_missing')

      const allTasks = (await taskService.listTasks()).tasks
      const children = allTasks.filter((task) => task.parentTaskId === parentTaskId)
      expect(children).toHaveLength(0)
    } finally {
      runtimeManager.stop()
      await safeRemoveDir(dir)
    }
  })

  test('createSubtasks requires RuntimeManager to be running', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent])
    expect(runtimeManager.isRunning).toBe(false)

    try {
      const { taskId: parentTaskId } = await taskService.createTask({
        title: 'Parent',
        agentId: completingAgent.id
      })

      const tool = toolRegistry.get('createSubtasks')!
      const result = await tool.execute(
        {
          tasks: [{ agentId: completingAgent.id, title: 'Child' }]
        },
        {
          taskId: parentTaskId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      expect(result.isError).toBe(true)
      expect((result.output as any).error).toContain('RuntimeManager must be started')
    } finally {
      runtimeManager.stop()
      await safeRemoveDir(dir)
    }
  })

  test('createSubtasks is top-level only', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent])
    runtimeManager.start()

    try {
      const { taskId: parentTaskId } = await taskService.createTask({
        title: 'Parent',
        agentId: completingAgent.id
      })
      const { taskId: childTaskId } = await taskService.createTask({
        title: 'Child',
        agentId: completingAgent.id,
        parentTaskId
      })

      const tool = toolRegistry.get('createSubtasks')!
      const result = await tool.execute(
        {
          tasks: [{ agentId: completingAgent.id, title: 'Grandchild' }]
        },
        {
          taskId: childTaskId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      expect(result.isError).toBe(true)
      expect((result.output as any).error).toContain('top-level tasks')
    } finally {
      runtimeManager.stop()
      await safeRemoveDir(dir)
    }
  })

  test('createSubtasks abort cascades cancellation to unfinished children', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent, slowAgent])
    runtimeManager.start()

    try {
      const { taskId: parentTaskId } = await taskService.createTask({
        title: 'Parent',
        agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      const controller = new AbortController()
      const tool = toolRegistry.get('createSubtasks')!
      const resultPromise = tool.execute(
        {
          tasks: [{ agentId: slowAgent.id, title: 'Slow child' }]
        },
        {
          taskId: parentTaskId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore,
          signal: controller.signal
        }
      )

      await new Promise((resolve) => setTimeout(resolve, 30))
      controller.abort()

      const result = await resultPromise
      expect(result.isError).toBe(false)
      const parsed = result.output as any
      expect(parsed.tasks).toHaveLength(1)
      expect(parsed.tasks[0].status).toBe('Cancel')

      const childTaskId = parsed.tasks[0].taskId as string
      const childTask = await taskService.getTask(childTaskId)
      expect(childTask?.status).toBe('canceled')
    } finally {
      runtimeManager.stop()
      await safeRemoveDir(dir)
    }
  })

  test('listSubtask returns viable sub-agents with metadata', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent, failingAgent])
    runtimeManager.start()

    try {
      const { taskId: parentTaskId } = await taskService.createTask({
        title: 'Parent',
        agentId: completingAgent.id
      })
      await runtimeManager.waitForIdle()

      const listTool = toolRegistry.get('listSubtask')!
      const listResult = await listTool.execute(
        {},
        {
          taskId: parentTaskId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      expect(listResult.isError).toBe(false)
      const parsed = listResult.output as any
      expect(parsed.total).toBe(2)
      expect(parsed.agents).toHaveLength(2)

      const [firstAgent, secondAgent] = parsed.agents
      expect(firstAgent.agentId).toBe('agent_completer')
      expect(firstAgent.displayName).toBe('Completer')
      expect(firstAgent.description).toBe('Completes immediately with summary.')
      expect(firstAgent.toolGroups).toEqual([])
      expect(firstAgent.defaultProfile).toBe('fast')
      expect(firstAgent.isDefault).toBe(true)
      expect(firstAgent.isCurrent).toBe(true)

      expect(secondAgent.agentId).toBe('agent_failer')
      expect(secondAgent.displayName).toBe('Failer')
      expect(secondAgent.description).toBe('Fails immediately.')
      expect(secondAgent.toolGroups).toEqual([])
      expect(secondAgent.defaultProfile).toBe('fast')
      expect(secondAgent.isDefault).toBe(false)
      expect(secondAgent.isCurrent).toBe(false)
    } finally {
      runtimeManager.stop()
      await safeRemoveDir(dir)
    }
  })

  test('listSubtask is top-level only', async () => {
    const { dir, taskService, runtimeManager, toolRegistry } = await createIntegrationEnv([completingAgent])
    runtimeManager.start()

    try {
      const { taskId: parentTaskId } = await taskService.createTask({
        title: 'Parent',
        agentId: completingAgent.id
      })
      const { taskId: childTaskId } = await taskService.createTask({
        title: 'Child',
        agentId: completingAgent.id,
        parentTaskId
      })

      const listTool = toolRegistry.get('listSubtask')!
      const result = await listTool.execute(
        {},
        {
          taskId: childTaskId,
          actorId: DEFAULT_AGENT_ACTOR_ID,
          baseDir: dir,
          artifactStore: mockArtifactStore
        }
      )

      expect(result.isError).toBe(true)
      expect((result.output as any).error).toContain('top-level tasks')
    } finally {
      runtimeManager.stop()
      await safeRemoveDir(dir)
    }
  })
})
