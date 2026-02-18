/**
 * Tests for per-task serialization in RuntimeManager (CC-001/CC-002/CC-006).
 *
 * Verifies that concurrent events for the same task are serialised via
 * the per-task AsyncMutex lock, preventing overlapping execution.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi, afterEach } from 'vitest'
import { JsonlEventStore } from '../../src/infrastructure/persistence/jsonlEventStore.js'
import { JsonlAuditLog } from '../../src/infrastructure/persistence/jsonlAuditLog.js'
import { JsonlConversationStore } from '../../src/infrastructure/persistence/jsonlConversationStore.js'
import { TaskService } from '../../src/application/services/taskService.js'
import { InteractionService } from '../../src/application/services/interactionService.js'
import { RuntimeManager } from '../../src/agents/orchestration/runtimeManager.js'
import { ConversationManager } from '../../src/agents/orchestration/conversationManager.js'
import { OutputHandler } from '../../src/agents/orchestration/outputHandler.js'
import { FakeLLMClient } from '../../src/infrastructure/llm/fakeLLMClient.js'
import { DefaultToolRegistry } from '../../src/infrastructure/tools/toolRegistry.js'
import { DefaultToolExecutor } from '../../src/infrastructure/tools/toolExecutor.js'
import { ContextBuilder } from '../../src/application/context/contextBuilder.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'
import type { Agent, AgentContext, AgentOutput } from '../../src/agents/core/agent.js'
import type { TaskView } from '../../src/application/services/taskService.js'
import type { ArtifactStore } from '../../src/core/ports/artifactStore.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockArtifactStore: ArtifactStore = {
  readFile: async () => '',
  readFileRange: async () => '',
  listDir: async () => [],
  writeFile: async () => {},
  exists: async () => false,
  mkdir: async () => {},
  stat: async () => null
}

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

  const auditLog = new JsonlAuditLog({ auditPath: join(dir, 'audit.jsonl') })
  const toolRegistry = new DefaultToolRegistry()
  toolRegistry.register({
    name: 'noop',
    description: 'No-op',
    parameters: { type: 'object', properties: {} },
    group: 'search',
    riskLevel: () => 'safe',
    execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'ok' })
  })
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })
  const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
  const interactionService = new InteractionService(store, DEFAULT_USER_ACTOR_ID)
  const contextBuilder = new ContextBuilder(dir)
  const conversationManager = new ConversationManager({
    conversationStore, auditLog, toolRegistry, toolExecutor, artifactStore: mockArtifactStore
  })
  const outputHandler = new OutputHandler({
    toolExecutor, toolRegistry, artifactStore: mockArtifactStore, conversationManager
  })

  return { store, conversationStore, taskService, interactionService, toolRegistry, contextBuilder, conversationManager, outputHandler }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Per-task serialization (CC-001)', () => {
  let dirs: string[] = []
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs = []
  })

  test('concurrent executeTask calls on SAME task are serialized', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    dirs.push(dir)
    const infra = await makeInfra(dir)

    // Track execution order
    const executionOrder: string[] = []
    let resolveFirst!: () => void
    const firstBlocks = new Promise<void>(r => { resolveFirst = r })

    const slowAgent: Agent = {
      id: 'agent_slow',
      displayName: 'Slow Agent',
      description: 'Test slow agent',
      toolGroups: [],
      defaultProfile: 'fast',
      async *run(_task: TaskView, _ctx: AgentContext): AsyncGenerator<AgentOutput> {
        executionOrder.push('start-1')
        await firstBlocks
        executionOrder.push('end-1')
        yield { kind: 'done' }
      }
    }

    // Second call uses same agent but tracks differently
    let callCount = 0
    const trackingAgent: Agent = {
      id: 'agent_track',
      displayName: 'Tracker',
      description: 'Test tracking agent',
      toolGroups: [],
      defaultProfile: 'fast',
      async *run(_task: TaskView, _ctx: AgentContext): AsyncGenerator<AgentOutput> {
        callCount++
        if (callCount === 1) {
          executionOrder.push('start-1')
          await firstBlocks
          executionOrder.push('end-1')
        } else {
          executionOrder.push('start-2')
          executionOrder.push('end-2')
        }
        yield { kind: 'done' }
      }
    }

    const manager = new RuntimeManager(infra)
    manager.registerAgent(trackingAgent)
    manager.start()

    // Create a task
    const { taskId } = await infra.taskService.createTask({
      title: 'Test Serialization',
      agentId: 'agent_track'
    })

    // Launch two concurrent executeTask calls
    const p1 = manager.executeTask(taskId)
    const p2 = manager.executeTask(taskId)

    // Allow first to complete
    await new Promise(r => setTimeout(r, 50))
    resolveFirst()

    await Promise.all([p1, p2])
    await manager.waitForIdle()

    // With serialization: start-1 → end-1 → start-2 → end-2
    // Without serialization: start-1 → start-2 → ... (interleaved)
    const startIndices = executionOrder
      .map((e, i) => e.startsWith('start') ? i : -1)
      .filter(i => i >= 0)
    const endIndices = executionOrder
      .map((e, i) => e.startsWith('end') ? i : -1)
      .filter(i => i >= 0)

    // The second start must come after the first end (serialized)
    if (startIndices.length >= 2 && endIndices.length >= 1) {
      expect(startIndices[1]).toBeGreaterThan(endIndices[0])
    }

    manager.stop()
  })

  test('concurrent events for DIFFERENT tasks run in parallel', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    dirs.push(dir)
    const infra = await makeInfra(dir)

    const parallelTimestamps: { taskId: string; time: number }[] = []
    const startTime = Date.now()

    // Agent that takes ~50ms to execute
    const slowAgent: Agent = {
      id: 'agent_parallel',
      displayName: 'Parallel Agent',
      description: 'Test parallel agent',
      toolGroups: [],
      defaultProfile: 'fast',
      async *run(task: TaskView, _ctx: AgentContext): AsyncGenerator<AgentOutput> {
        parallelTimestamps.push({ taskId: task.taskId, time: Date.now() - startTime })
        await new Promise(r => setTimeout(r, 50))
        yield { kind: 'done' }
      }
    }

    const manager = new RuntimeManager(infra)
    manager.registerAgent(slowAgent)

    // Create two separate tasks
    const { taskId: t1 } = await infra.taskService.createTask({ title: 'Task A', agentId: 'agent_parallel' })
    const { taskId: t2 } = await infra.taskService.createTask({ title: 'Task B', agentId: 'agent_parallel' })

    // Execute both concurrently
    const [r1, r2] = await Promise.all([
      manager.executeTask(t1),
      manager.executeTask(t2)
    ])

    expect(r1.taskId).toBe(t1)
    expect(r2.taskId).toBe(t2)

    // Both tasks started within a short window (parallel, not serialized)
    if (parallelTimestamps.length >= 2) {
      const timeDiff = Math.abs(parallelTimestamps[0].time - parallelTimestamps[1].time)
      // If they were serial, diff would be >= 50ms
      expect(timeDiff).toBeLessThan(40)
    }

    manager.stop()
  })
})

describe('Single-flight execution guard (CC-008)', () => {
  let dirs: string[] = []
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs = []
  })

  test('isExecuting prevents overlapping agent loops for same runtime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    dirs.push(dir)
    const infra = await makeInfra(dir)

    let concurrentCalls = 0
    let maxConcurrent = 0

    const guardedAgent: Agent = {
      id: 'agent_guarded',
      displayName: 'Guarded',
      description: 'Test guarded agent',
      toolGroups: [],
      defaultProfile: 'fast',
      async *run(_task: TaskView, _ctx: AgentContext): AsyncGenerator<AgentOutput> {
        concurrentCalls++
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls)
        await new Promise(r => setTimeout(r, 30))
        concurrentCalls--
        yield { kind: 'done' }
      }
    }

    const manager = new RuntimeManager(infra)
    manager.registerAgent(guardedAgent)

    const { taskId } = await infra.taskService.createTask({ title: 'Guard Test', agentId: 'agent_guarded' })

    // Execute the same task twice concurrently
    await Promise.all([
      manager.executeTask(taskId),
      manager.executeTask(taskId)
    ])

    // Due to per-task lock + isExecuting guard, max concurrent should be 1
    expect(maxConcurrent).toBe(1)

    manager.stop()
  })
})
