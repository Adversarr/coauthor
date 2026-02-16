import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { JsonlEventStore } from '../../src/infrastructure/persistence/jsonlEventStore.js'
import { JsonlConversationStore } from '../../src/infrastructure/persistence/jsonlConversationStore.js'
import { JsonlAuditLog } from '../../src/infrastructure/persistence/jsonlAuditLog.js'
import { TaskService } from '../../src/application/services/taskService.js'
import { RuntimeManager } from '../../src/agents/orchestration/runtimeManager.js'
import { AgentRuntime } from '../../src/agents/core/runtime.js'
import { ConversationManager } from '../../src/agents/orchestration/conversationManager.js'
import { OutputHandler } from '../../src/agents/orchestration/outputHandler.js'
import { DefaultSeedAgent } from '../../src/agents/implementations/defaultAgent.js'
import { FakeLLMClient } from '../../src/infrastructure/llm/fakeLLMClient.js'
import { DefaultToolRegistry } from '../../src/infrastructure/tools/toolRegistry.js'
import { DefaultToolExecutor } from '../../src/infrastructure/tools/toolExecutor.js'
import { ContextBuilder } from '../../src/application/context/contextBuilder.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import type { DomainEvent, UserInteractionRespondedPayload } from '../../src/core/events/events.js'
import type { ArtifactStore } from '../../src/core/ports/artifactStore.js'
import type { LLMMessage } from '../../src/core/ports/llmClient.js'
import { buildConfirmInteraction } from '../../src/agents/display/displayBuilder.js'

async function createTestInfra(
  dir: string,
  opts?: {
    tool1RiskLevel?: 'safe' | 'risky'
    tool2RiskLevel?: 'safe' | 'risky'
  }
) {
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
    writeFile: async () => {},
    exists: async () => false,
    mkdir: async () => {},
    stat: async () => null
  }

  const auditLog = new JsonlAuditLog({ auditPath: join(dir, 'audit.jsonl') })
  const toolRegistry = new DefaultToolRegistry()
  
  // Register tools
  const tool1 = vi.fn().mockResolvedValue({ toolCallId: 'placeholder', isError: false, output: 'done1' })
  toolRegistry.register({
    name: 'tool1',
    description: 'Tool 1',
    parameters: { type: 'object', properties: {} },
    group: 'search',
    riskLevel: opts?.tool1RiskLevel ?? 'safe',
    execute: tool1
  })

  const tool2 = vi.fn().mockResolvedValue({ toolCallId: 'placeholder', isError: false, output: 'done2' })
  toolRegistry.register({
    name: 'tool2',
    description: 'Tool 2',
    parameters: { type: 'object', properties: {} },
    group: 'search',
    riskLevel: opts?.tool2RiskLevel ?? 'safe',
    execute: tool2
  })

  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })
  const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
  const contextBuilder = new ContextBuilder(dir, artifactStore)
  const llm = new FakeLLMClient()
  const agent = new DefaultSeedAgent({ contextBuilder })

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

  return {
    store,
    runtimeManager,
    taskService,
    conversationStore,
    toolRegistry,
    conversationManager,
    outputHandler,
    tool1,
    tool2,
    llm,
    agent
  }
}

describe('Runtime Pending Tool Execution', () => {
  let dir: string

  test('executes pending tool calls from previous turn', async () => {
    dir = mkdtempSync(join(tmpdir(), 'seed-test-'))
    const { runtimeManager, taskService, conversationStore, tool1, tool2, llm, agent } = await createTestInfra(dir)

    // Create task
    const { taskId } = await taskService.createTask({ 
      title: 'Test Task',
      agentId: agent.id 
    })

    // Manually seed conversation with partial state
    // Assistant asked for tool1 and tool2
    // tool1 finished
    // tool2 is pending
    const history: LLMMessage[] = [
      { role: 'user', content: 'run tools' },
      { 
        role: 'assistant', 
        content: undefined,
        toolCalls: [
          { toolCallId: 'call_1', toolName: 'tool1', arguments: {} },
          { toolCallId: 'call_2', toolName: 'tool2', arguments: {} }
        ] 
      },
      { role: 'tool', toolCallId: 'call_1', toolName: 'tool1', content: '"done1"' }
    ]

    for (const msg of history) {
      // @ts-ignore
      await conversationStore.append(taskId, msg)
    }

    const spyLLM = vi.spyOn(llm, 'complete')

    // Execute runtime
    await runtimeManager.executeTask(taskId)

    // Expect tool2 to have been executed
    expect(tool2).toHaveBeenCalled()
    expect(tool1).not.toHaveBeenCalled() // Should not re-execute tool1

    // Verify history has tool2 result
    const messages = await conversationStore.getMessages(taskId)
    const tool2Msg = messages.find(m => m.role === 'tool' && m.toolCallId === 'call_2')
    expect(tool2Msg).toBeDefined()
    expect(tool2Msg?.content).toContain('done2')

    // Verify LLM was called with full history (including tool2 result)
    expect(spyLLM).toHaveBeenCalled()
    const lastArgs = spyLLM.mock.calls[spyLLM.mock.calls.length - 1][0]
    const lastHistory = lastArgs.messages
    const lastMsg = lastHistory[lastHistory.length - 1]
    expect(lastMsg.role).toBe('tool')
    expect((lastMsg as any).toolCallId).toBe('call_2')
    
    // Cleanup
    rmSync(dir, { recursive: true, force: true })
  })

  test('rejects only the bound risky tool call in a batch', async () => {
    dir = mkdtempSync(join(tmpdir(), 'seed-test-'))
    const { store, taskService, conversationStore, tool1, tool2, llm, agent, toolRegistry, conversationManager, outputHandler } =
      await createTestInfra(dir, { tool1RiskLevel: 'risky', tool2RiskLevel: 'risky' })

    const { taskId } = await taskService.createTask({
      title: 'Reject only one risky call',
      agentId: agent.id
    })

    const startedEvent: DomainEvent = {
      type: 'TaskStarted',
      payload: {
        taskId,
        agentId: agent.id,
        authorActorId: agent.id
      }
    }
    await store.append(taskId, [startedEvent])

    const seededHistory: LLMMessage[] = [
      { role: 'user', content: 'do risky things' },
      {
        role: 'assistant',
        content: undefined,
        toolCalls: [
          { toolCallId: 'call_1', toolName: 'tool1', arguments: {} },
          { toolCallId: 'call_2', toolName: 'tool2', arguments: {} }
        ]
      }
    ]

    for (const message of seededHistory) {
      // @ts-ignore
      await conversationStore.append(taskId, message)
    }

    const confirmRequest = buildConfirmInteraction({
      toolCallId: 'call_1',
      toolName: 'tool1',
      arguments: {}
    })

    const requestedEvent: DomainEvent = {
      type: 'UserInteractionRequested',
      payload: {
        taskId,
        interactionId: confirmRequest.interactionId,
        kind: confirmRequest.kind,
        purpose: confirmRequest.purpose,
        display: confirmRequest.display,
        options: confirmRequest.options,
        validation: confirmRequest.validation,
        authorActorId: agent.id
      }
    }
    await store.append(taskId, [requestedEvent])

    const respondedEvent: DomainEvent = {
      type: 'UserInteractionResponded',
      payload: {
        taskId,
        interactionId: confirmRequest.interactionId,
        selectedOptionId: 'reject',
        authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }
    await store.append(taskId, [respondedEvent])

    const runtime = new AgentRuntime({
      taskId,
      store,
      taskService,
      agent,
      llm,
      toolRegistry,
      baseDir: dir,
      conversationManager,
      outputHandler
    })

    await runtime.resume(respondedEvent.payload as UserInteractionRespondedPayload)

    expect(tool1).not.toHaveBeenCalled()
    expect(tool2).not.toHaveBeenCalled()

    const messages = await conversationStore.getMessages(taskId)
    const tool1Result = messages.find((m) => m.role === 'tool' && m.toolCallId === 'call_1')
    const tool2Result = messages.find((m) => m.role === 'tool' && m.toolCallId === 'call_2')

    expect(tool1Result).toBeDefined()
    expect(tool1Result?.content).toContain('User rejected the request')
    expect(tool2Result).toBeUndefined()

    const events = await store.readStream(taskId)
    const latestRequestEvent = [...events].reverse().find((e) => e.type === 'UserInteractionRequested')
    expect(latestRequestEvent).toBeDefined()
    const latestToolCallId = (latestRequestEvent as any).payload.display?.metadata?.toolCallId
    expect(latestToolCallId).toBe('call_2')

    rmSync(dir, { recursive: true, force: true })
  })
})
