import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { JsonlEventStore } from '../../src/infrastructure/persistence/jsonlEventStore.js'
import { JsonlAuditLog } from '../../src/infrastructure/persistence/jsonlAuditLog.js'
import { JsonlConversationStore } from '../../src/infrastructure/persistence/jsonlConversationStore.js'
import { TaskService } from '../../src/application/services/taskService.js'
import { RuntimeManager } from '../../src/agents/orchestration/runtimeManager.js'
import { ConversationManager } from '../../src/agents/orchestration/conversationManager.js'
import { OutputHandler } from '../../src/agents/orchestration/outputHandler.js'
import { registerAgentGroupTools } from '../../src/infrastructure/tools/agentGroupTools.js'
import { DefaultToolRegistry } from '../../src/infrastructure/tools/toolRegistry.js'
import { DefaultToolExecutor } from '../../src/infrastructure/tools/toolExecutor.js'
import { FakeLLMClient } from '../../src/infrastructure/llm/fakeLLMClient.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'
import type { Agent, AgentOutput } from '../../src/agents/core/agent.js'
import type { ToolGroup } from '../../src/core/ports/tool.js'
import type { ArtifactStore } from '../../src/core/ports/artifactStore.js'

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

describe('Runtime subtask-group visibility', () => {
  test('top-level tasks see subtask-group tools; child tasks do not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-runtime-group-'))
    const seenToolNamesByTask = new Map<string, string[]>()

    const agent: Agent = {
      id: DEFAULT_AGENT_ACTOR_ID,
      displayName: 'Coordinator',
      description: 'Captures exposed tool names per task.',
      toolGroups: ['subtask'] as readonly ToolGroup[],
      defaultProfile: 'fast',
      async *run(task, context) {
        seenToolNamesByTask.set(task.taskId, context.tools.list().map((tool) => tool.name).sort())
        yield { kind: 'done', summary: 'captured' } as AgentOutput
      }
    }

    try {
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
      runtimeManager.registerAgent(agent)

      registerAgentGroupTools(toolRegistry, {
        store,
        taskService,
        conversationStore,
        runtimeManager
      })

      const { taskId: rootTaskId } = await taskService.createTask({
        title: 'Root',
        agentId: agent.id
      })
      const { taskId: childTaskId } = await taskService.createTask({
        title: 'Child',
        agentId: agent.id,
        parentTaskId: rootTaskId
      })

      await runtimeManager.executeTask(rootTaskId)
      await runtimeManager.executeTask(childTaskId)

      expect(seenToolNamesByTask.get(rootTaskId)).toEqual(['createSubtasks', 'listSubtask'])
      expect(seenToolNamesByTask.get(childTaskId)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
