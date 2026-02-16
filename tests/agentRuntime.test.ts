import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { JsonlEventStore } from '../src/infrastructure/persistence/jsonlEventStore.js'
import { JsonlAuditLog } from '../src/infrastructure/persistence/jsonlAuditLog.js'
import { JsonlConversationStore } from '../src/infrastructure/persistence/jsonlConversationStore.js'
import { TaskService } from '../src/application/services/taskService.js'
import { InteractionService } from '../src/application/services/interactionService.js'
import { ContextBuilder } from '../src/application/context/contextBuilder.js'
import { RuntimeManager } from '../src/agents/orchestration/runtimeManager.js'
import { ConversationManager } from '../src/agents/orchestration/conversationManager.js'
import { OutputHandler } from '../src/agents/orchestration/outputHandler.js'
import { DefaultSeedAgent } from '../src/agents/implementations/defaultAgent.js'
import { FakeLLMClient } from '../src/infrastructure/llm/fakeLLMClient.js'

/**
 * Wait for a pending interaction to appear for a task.
 * Returns the pending interactionId once available.
 */
async function waitForPendingInteraction(
  interactionService: InteractionService,
  taskId: string,
  timeoutMs = 5000
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const pending = await interactionService.getPendingInteraction(taskId)
    if (pending) return pending.interactionId
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error(`Timed out waiting for pending interaction on task ${taskId}`)
}
import { DefaultToolRegistry } from '../src/infrastructure/tools/toolRegistry.js'
import { DefaultToolExecutor } from '../src/infrastructure/tools/toolExecutor.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../src/core/entities/actor.js'
import type { LLMClient, LLMResponse } from '../src/core/ports/llmClient.js'
import type { ToolCallRequest, ToolResult, ToolExecutor } from '../src/core/ports/tool.js'

import type { ArtifactStore } from '../src/core/ports/artifactStore.js'

/**
 * Helper to create test infrastructure in a temp directory.
 *
 * Returns a RuntimeManager (which owns task-scoped AgentRuntime instances)
 * instead of a bare AgentRuntime.
 */
async function createTestInfra(dir: string, opts?: { llm?: LLMClient, toolExecutor?: ToolExecutor }) {
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
  
  // Register a dummy tool for testing
  toolRegistry.register({
    name: 'dummy_tool',
    description: 'A dummy tool',
    parameters: { type: 'object', properties: {} },
    group: 'search',
    riskLevel: 'safe',
    execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'dummy' })
  })

  const toolExecutor = opts?.toolExecutor ?? new DefaultToolExecutor({ registry: toolRegistry, auditLog })
  const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
  const interactionService = new InteractionService(store, DEFAULT_USER_ACTOR_ID)
  const contextBuilder = new ContextBuilder(dir)
  const llm = opts?.llm ?? new FakeLLMClient()
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

  const manager = new RuntimeManager({
    store,
    taskService,
    llm,
    toolRegistry,
    baseDir: dir,
    conversationManager,
    outputHandler
  })
  manager.registerAgent(agent)

  return { store, conversationStore, taskService, interactionService, manager, llm, agent, toolRegistry }
}

describe('AgentRuntime (via RuntimeManager)', () => {
  test('executeTask writes TaskStarted and completes without confirm_task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const { store, taskService, manager } = await createTestInfra(dir)

    await store.append('t1', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't1',
          title: 'T1',
          intent: 'test intent',
          priority: 'foreground',
          agentId: DEFAULT_AGENT_ACTOR_ID,
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    const res = await manager.executeTask('t1')
    expect(res.taskId).toBe('t1')

    const events = await store.readStream('t1', 1)

    // Verify TaskStarted was emitted
    const startedEvt = events.find((e) => e.type === 'TaskStarted')
    expect(startedEvt).toBeTruthy()
    if (startedEvt?.type === 'TaskStarted') {
      expect(startedEvt.payload.agentId).toBe(DEFAULT_AGENT_ACTOR_ID)
    }

    // Should not emit confirm_task interaction
    expect(events.some((e) => e.type === 'UserInteractionRequested')).toBe(false)

    // Verify TaskCompleted was emitted
    expect(events.some((e) => e.type === 'TaskCompleted')).toBe(true)

    // Task should be done
    const view = await taskService.getTask('t1')
    expect(view?.status).toBe('done')
    expect(view?.agentId).toBe(DEFAULT_AGENT_ACTOR_ID)

    rmSync(dir, { recursive: true, force: true })
  })

  test('start executes assigned tasks without confirm_task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const { store, manager } = await createTestInfra(dir)

    manager.start()

    // Create a task assigned to this agent
    await store.append('t2', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't2',
          title: 'T2',
          intent: '',
          priority: 'foreground',
          agentId: DEFAULT_AGENT_ACTOR_ID,
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    await manager.waitForIdle()
    manager.stop()

    const events = await store.readStream('t2', 1)
    expect(events.some((e) => e.type === 'TaskStarted')).toBe(true)
    expect(events.some((e) => e.type === 'TaskCompleted')).toBe(true)
    expect(events.some((e) => e.type === 'UserInteractionRequested')).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })

  test('queues instruction added while task is running and re-executes after completion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))

    const baseLLM = new FakeLLMClient()
    let releaseLLM!: () => void
    let callCount = 0
    const delayedLLM: LLMClient = {
      async complete(options) {
        callCount++
        if (callCount === 1) {
          // Block first call so we can add instruction mid-execution
          await new Promise<void>((resolve) => { releaseLLM = resolve })
        }
        return baseLLM.complete(options)
      },
      stream(options, onChunk) {
        return baseLLM.stream(options, onChunk)
      }
    }

    const { store, taskService, manager } = await createTestInfra(dir, { llm: delayedLLM })

    manager.start()

    const { taskId } = await taskService.createTask({
      title: 'Queue Instruction',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    // Wait for handler to start and reach LLM call
    await new Promise(r => setTimeout(r, 20))

    await taskService.addInstruction(taskId, 'Please apply this while running')

    // Release the LLM so both executions complete
    releaseLLM()
    await manager.waitForIdle()
    manager.stop()

    const completedCount = (await store.readStream(taskId)).filter((e) => e.type === 'TaskCompleted').length
    expect(completedCount).toBe(2)

    rmSync(dir, { recursive: true, force: true })
  })

  test('ignores tasks assigned to other agents', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const { store, manager } = await createTestInfra(dir)

    manager.start()

    // Create a task assigned to a DIFFERENT agent
    await store.append('t3', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't3',
          title: 'T3',
          intent: '',
          priority: 'foreground',
          agentId: 'other_agent_id',
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    await manager.waitForIdle()
    manager.stop()

    const events = await store.readStream('t3', 1)
    // Should only have TaskCreated, no TaskStarted from our agent
    expect(events.length).toBe(1)
    expect(events[0]?.type).toBe('TaskCreated')

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('Conversation Persistence (via RuntimeManager)', () => {
  test('conversation history is persisted during automatic task execution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const { store, conversationStore, manager } = await createTestInfra(dir)

    // Start manager first (to subscribe to events)
    manager.start()

    // Then create task (triggers event handler)
    await store.append('t1', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't1',
          title: 'Test Task',
          intent: 'Do something',
          priority: 'foreground',
          agentId: DEFAULT_AGENT_ACTOR_ID,
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    await manager.waitForIdle()
    manager.stop()

    // Conversation should have system + user prompts and at least one assistant message
    const messages = await conversationStore.getMessages('t1')
    expect(messages.length).toBeGreaterThanOrEqual(3)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.role).toBe('user')
    expect(messages.some((m) => m.role === 'assistant')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('conversation history survives runtime re-instantiation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    
    // First runtime instance
    const infra1 = await createTestInfra(dir)
    
    // Pre-populate conversation history
    await infra1.conversationStore.append('t1', { role: 'system', content: 'System prompt' })
    await infra1.conversationStore.append('t1', { role: 'user', content: 'User task' })
    await infra1.conversationStore.append('t1', { role: 'assistant', content: 'I will help' })

    // Create a new runtime instance (simulating app restart)
    const infra2 = await createTestInfra(dir)
    
    // The new conversation store should load persisted messages
    const messages = await infra2.conversationStore.getMessages('t1')
    expect(messages).toHaveLength(3)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.role).toBe('user')
    expect(messages[2]?.role).toBe('assistant')

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('Concurrency & State Management (via RuntimeManager)', () => {
  test('pause waits for pending tool calls to complete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    
    // 1. Mock LLM to return 2 tool calls
    const mockLLM: LLMClient = {
      complete: vi.fn().mockImplementationOnce(async () => {
        return {
          stopReason: 'tool_use',
          toolCalls: [
            { toolCallId: 'call_1', toolName: 'dummy_tool', arguments: {} },
            { toolCallId: 'call_2', toolName: 'dummy_tool', arguments: {} }
          ]
        } as LLMResponse
      }).mockImplementation(async () => {
         return { stopReason: 'end_turn', content: 'Done' }
      }),
      stream: vi.fn()
    }

    let toolExecCount = 0
    let resolveTools!: () => void
    const toolsStarted = new Promise<void>(r => { resolveTools = r })
    const mockToolExecutor: ToolExecutor = {
      execute: async (call) => {
        toolExecCount++
        if (toolExecCount >= 2) resolveTools()
        await new Promise(resolve => setTimeout(resolve, 10))
        return { toolCallId: call.toolCallId, output: 'success', isError: false }
      },
      recordRejection: (call) => ({ toolCallId: call.toolCallId, output: { isError: true, error: 'User rejected the request' }, isError: true })
    }

    const { conversationStore, taskService, manager } = await createTestInfra(dir, { 
      llm: mockLLM, 
      toolExecutor: mockToolExecutor 
    })

    manager.start()

    // Start task
    const { taskId } = await taskService.createTask({
      title: 'Concurrency Task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    // Wait for tool execution to start
    await toolsStarted
    
    // Trigger Pause NOW (while tools are running)
    await taskService.pauseTask(taskId, 'User paused')

    // Wait for all processing to finish
    await manager.waitForIdle()

    // Verify both tools executed
    expect(toolExecCount).toBe(2)
    
    // Verify task is paused (eventually)
    const task = await taskService.getTask(taskId)
    expect(task?.status).toBe('paused')
    
    // Verify conversation history has results for BOTH calls
    const messages = await conversationStore.getMessages(taskId)
    expect(messages.some(m => m.role === 'tool' && m.toolCallId === 'call_1')).toBe(true)
    expect(messages.some(m => m.role === 'tool' && m.toolCallId === 'call_2')).toBe(true)
    
    // Cleanup
    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('instruction added during unsafe state is queued and injected later', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    
    const mockLLM: LLMClient = {
      complete: vi.fn().mockImplementationOnce(async () => {
        return {
          stopReason: 'tool_use',
          toolCalls: [
            { toolCallId: 'call_1', toolName: 'dummy_tool', arguments: {} }
          ]
        }
      }).mockImplementation(async () => {
         return { stopReason: 'end_turn', content: 'Done' }
      }),
      stream: vi.fn()
    }

    let resolveTool: ((value: unknown) => void) | null = null
    const mockToolExecutor: ToolExecutor = {
      execute: async (call) => {
        await new Promise(resolve => { resolveTool = resolve })
        return { toolCallId: call.toolCallId, output: 'success', isError: false }
      },
      recordRejection: (call) => ({ toolCallId: call.toolCallId, output: { isError: true, error: 'User rejected the request' }, isError: true })
    }

    const { conversationStore, taskService, manager } = await createTestInfra(dir, { 
      llm: mockLLM, 
      toolExecutor: mockToolExecutor 
    })

    manager.start()
    const { taskId } = await taskService.createTask({ title: 'Queue', agentId: DEFAULT_AGENT_ACTOR_ID })
    
    // Wait for tool to start executing (blocked on manual resolve)
    await new Promise(r => setTimeout(r, 20))

    // Add instruction NOW (unsafe state: assistant has call, no result yet)
    await taskService.addInstruction(taskId, 'Interrupted Instruction')
    
    // Verify NOT in history yet
    let messages = await conversationStore.getMessages(taskId)
    const injectedMsg = messages.find(m => m.role === 'user' && m.content === 'Interrupted Instruction')
    expect(injectedMsg).toBeUndefined()

    // Finish tool execution
    if (resolveTool) (resolveTool as any)('done')
    await manager.waitForIdle()
    
    // Verify instruction IS now in history (after tool result)
    messages = await conversationStore.getMessages(taskId)
    
    // Check sequence: Tool -> User (Instruction)
    const toolMsgIndex = messages.findIndex(m => m.role === 'tool' && m.toolCallId === 'call_1')
    const userMsgIndex = messages.findIndex(m => m.role === 'user' && m.content === 'Interrupted Instruction')
    
    expect(toolMsgIndex).toBeGreaterThan(-1)
    expect(userMsgIndex).toBeGreaterThan(-1)
    expect(userMsgIndex).toBeGreaterThan(toolMsgIndex)

    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('auto-repairs dangling tool calls on resume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const { store, conversationStore, manager, taskService } = await createTestInfra(dir)

    // 1. Manually create a broken history
    const { taskId: realTaskId } = await taskService.createTask({ title: 'Broken', agentId: DEFAULT_AGENT_ACTOR_ID })
    
    // Fix: Move to paused state so resumeTask is valid
    await store.append(realTaskId, [
      { type: 'TaskStarted', payload: { taskId: realTaskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } },
      { type: 'TaskPaused', payload: { taskId: realTaskId, authorActorId: DEFAULT_USER_ACTOR_ID } }
    ])

    await conversationStore.append(realTaskId, { 
      role: 'assistant', 
      toolCalls: [{ toolCallId: 'call_x', toolName: 'risky_tool', arguments: {} }] 
    })
    
    // 2. Start manager
    manager.start()
    await taskService.resumeTask(realTaskId)
    
    // 3. Allow processing
    await manager.waitForIdle()
    
    // 4. Verify history is repaired
    const messages = await conversationStore.getMessages(realTaskId)
    const toolMsg = messages.find(m => m.role === 'tool' && m.toolCallId === 'call_x')
    
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.content).toContain('interrupted')

    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('retries dangling safe tool calls on resume and persists result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))

    const mockLLM: LLMClient = {
      complete: vi.fn().mockResolvedValue({ stopReason: 'end_turn', content: 'Done' }),
      stream: vi.fn()
    }

    const toolExec = vi.fn(async (call: ToolCallRequest) => {
      return { toolCallId: call.toolCallId, output: { repaired: true }, isError: false } as ToolResult
    })

    const mockToolExecutor: ToolExecutor = {
      execute: toolExec,
      recordRejection: (call) => ({ toolCallId: call.toolCallId, output: { isError: true, error: 'User rejected the request' }, isError: true })
    }

    const { store, conversationStore, manager, taskService } = await createTestInfra(dir, { llm: mockLLM, toolExecutor: mockToolExecutor })

    const { taskId } = await taskService.createTask({ title: 'Safe Repair', agentId: DEFAULT_AGENT_ACTOR_ID })
    
    // Fix: Move to paused state
    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } },
      { type: 'TaskPaused', payload: { taskId, authorActorId: DEFAULT_USER_ACTOR_ID } }
    ])

    await conversationStore.append(taskId, {
      role: 'assistant',
      toolCalls: [{ toolCallId: 'call_safe', toolName: 'dummy_tool', arguments: {} }]
    })

    manager.start()
    await taskService.resumeTask(taskId)
    await manager.waitForIdle()

    expect(toolExec).toHaveBeenCalled()
    expect((await conversationStore.getMessages(taskId)).some(m => m.role === 'tool' && m.toolCallId === 'call_safe')).toBe(true)

    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('does not inject interrupted error for dangling risky tools on resume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const { store, conversationStore, manager, taskService, toolRegistry } = await createTestInfra(dir)
    
    // Register risky tool
    toolRegistry.register({
      name: 'risky_tool',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      group: 'search',
      riskLevel: 'risky',
      execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'done' })
    })

    const { taskId } = await taskService.createTask({ title: 'Risky Resume', agentId: DEFAULT_AGENT_ACTOR_ID })
    
    // Fix: Move to paused
    await store.append(taskId, [
      { type: 'TaskStarted', payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID } },
      { type: 'TaskPaused', payload: { taskId, authorActorId: DEFAULT_USER_ACTOR_ID } }
    ])

    // Manually inject dangling risky tool call
    await conversationStore.append(taskId, { 
      role: 'assistant', 
      toolCalls: [{ toolCallId: 'call_risky', toolName: 'risky_tool', arguments: {} }] 
    })
    
    manager.start()
    
    // Trigger resume to force repair
    await taskService.resumeTask(taskId)

    // Wait for repair
    await manager.waitForIdle()
    
    // Verify NO tool message injected
    const messages = await conversationStore.getMessages(taskId)
    const toolMsg = messages.find(m => m.role === 'tool' && m.toolCallId === 'call_risky')
    
    expect(toolMsg).toBeUndefined()

    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('executes dangling risky tool call when approved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))

    const toolExec = vi.fn(async (call: ToolCallRequest, ctx: any) => {
      return { toolCallId: call.toolCallId, output: { ok: true, confirmedInteractionId: ctx.confirmedInteractionId }, isError: false } as ToolResult
    })

    const mockToolExecutor: ToolExecutor = {
      execute: toolExec as any,
      recordRejection: (call) => ({ toolCallId: call.toolCallId, output: { isError: true, error: 'User rejected the request' }, isError: true })
    }

    const { conversationStore, manager, taskService, interactionService, toolRegistry } = await createTestInfra(dir, {
      toolExecutor: mockToolExecutor
    })

    toolRegistry.register({
      name: 'risky_tool_approve',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      group: 'search',
      riskLevel: 'risky',
      execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'done' })
    })

    const { taskId } = await taskService.createTask({ title: 'Risky Approve', agentId: DEFAULT_AGENT_ACTOR_ID })
    await conversationStore.append(taskId, {
      role: 'assistant',
      toolCalls: [{ toolCallId: 'call_risky', toolName: 'risky_tool_approve', arguments: {} }]
    })

    manager.start()
    // TaskCreated was emitted before subscription — trigger execution explicitly.
    // executeTask will pause at the UIP for the risky tool, then return.
    const execPromise = manager.executeTask(taskId)
    // Wait for the runtime to create the UIP for the risky tool
    const pendingId = await waitForPendingInteraction(interactionService, taskId)
    await execPromise // execution paused at UIP — safe to await now
    await interactionService.respondToInteraction(taskId, pendingId, { selectedOptionId: 'approve' })
    await manager.waitForIdle()

    expect(toolExec).toHaveBeenCalledTimes(1)
    const messages = await conversationStore.getMessages(taskId)
    const toolMsg = messages.find(m => m.role === 'tool' && m.toolCallId === 'call_risky')
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.content).toContain('ok')
    expect(toolMsg?.content).not.toContain('interrupted')

    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('writes rejection tool result when risky tool rejected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))

    const toolExec = vi.fn(async () => {
      return { toolCallId: 'call_risky', output: { ok: true }, isError: false } as ToolResult
    })

    const mockToolExecutor: ToolExecutor = {
      execute: toolExec as any,
      recordRejection: vi.fn((call) => ({ toolCallId: call.toolCallId, output: { isError: true, error: 'User rejected the request' }, isError: true }))
    }

    const { conversationStore, manager, taskService, interactionService, toolRegistry } = await createTestInfra(dir, {
      toolExecutor: mockToolExecutor
    })

    toolRegistry.register({
      name: 'risky_tool_reject',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      group: 'search',
      riskLevel: 'risky',
      execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'done' })
    })

    const { taskId } = await taskService.createTask({ title: 'Risky Reject', agentId: DEFAULT_AGENT_ACTOR_ID })
    await conversationStore.append(taskId, {
      role: 'assistant',
      toolCalls: [{ toolCallId: 'call_risky', toolName: 'risky_tool_reject', arguments: {} }]
    })

    manager.start()
    // TaskCreated was emitted before subscription — trigger execution explicitly.
    const execPromise = manager.executeTask(taskId)
    // Wait for the runtime to create the UIP for the risky tool
    const pendingId = await waitForPendingInteraction(interactionService, taskId)
    await execPromise // execution paused at UIP
    await interactionService.respondToInteraction(taskId, pendingId, { selectedOptionId: 'reject' })
    await manager.waitForIdle()

    expect(toolExec).toHaveBeenCalledTimes(0)
    // recordRejection should have been called (emits audit entries for live TUI)
    expect(mockToolExecutor.recordRejection).toHaveBeenCalledTimes(1)
    const messages = await conversationStore.getMessages(taskId)
    const toolMsg = messages.find(m => m.role === 'tool' && m.toolCallId === 'call_risky')
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.content).toContain('User rejected the request')

    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('queues instruction while awaiting risky confirmation and injects after tool result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))

    const mockLLM: LLMClient = {
      complete: vi
        .fn()
        .mockImplementationOnce(async () => {
          return {
            stopReason: 'tool_use',
            toolCalls: [{ toolCallId: 'call_risky', toolName: 'risky_tool_flow', arguments: {} }]
          } as LLMResponse
        })
        .mockImplementationOnce(async () => {
          return { stopReason: 'end_turn', content: 'Done' } as LLMResponse
        }),
      stream: vi.fn()
    }

    const toolExec = vi.fn(async (call: ToolCallRequest, ctx: any) => {
      return { toolCallId: call.toolCallId, output: { ok: true, confirmedInteractionId: ctx.confirmedInteractionId }, isError: false } as ToolResult
    })

    const mockToolExecutor: ToolExecutor = {
      execute: toolExec as any,
      recordRejection: (call) => ({ toolCallId: call.toolCallId, output: { isError: true, error: 'User rejected the request' }, isError: true })
    }

    const { store, conversationStore, manager, taskService, interactionService, toolRegistry } = await createTestInfra(dir, {
      llm: mockLLM,
      toolExecutor: mockToolExecutor
    })

    toolRegistry.register({
      name: 'risky_tool_flow',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      group: 'search',
      riskLevel: 'risky',
      execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'done' })
    })

    manager.start()
    const { taskId } = await taskService.createTask({ title: 'Risky + Instruction', agentId: DEFAULT_AGENT_ACTOR_ID })

    // Wait for the interaction request to appear
    await manager.waitForIdle()

    const requested = (await store.readStream(taskId)).find(e => e.type === 'UserInteractionRequested')
    expect(requested?.type).toBe('UserInteractionRequested')
    const interactionId = requested?.type === 'UserInteractionRequested' ? requested.payload.interactionId : ''
    expect(interactionId).toBeTruthy()

    await taskService.addInstruction(taskId, 'Follow-up instruction')
    // Give some time for the instruction event handler
    await new Promise(r => setTimeout(r, 10))

    const before = await conversationStore.getMessages(taskId)
    expect(before.some(m => m.role === 'user' && m.content === 'Follow-up instruction')).toBe(false)

    await interactionService.respondToInteraction(taskId, interactionId, { selectedOptionId: 'approve' })
    await manager.waitForIdle()

    const after = await conversationStore.getMessages(taskId)
    const toolIndex = after.findIndex(m => m.role === 'tool' && m.toolCallId === 'call_risky')
    const instructionIndex = after.findIndex(m => m.role === 'user' && m.content === 'Follow-up instruction')
    expect(toolIndex).toBeGreaterThan(-1)
    expect(instructionIndex).toBeGreaterThan(-1)
    expect(instructionIndex).toBeGreaterThan(toolIndex)
    expect(after.some(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('interrupted'))).toBe(false)

    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('stress randomized pause/resume/instruction/interaction sequencing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))

    let llmCalls = 0
    const mockLLM: LLMClient = {
      complete: vi.fn().mockImplementation(async () => {
        llmCalls += 1
        if (llmCalls === 1) {
          return {
            stopReason: 'tool_use',
            toolCalls: [{ toolCallId: 'call_risky', toolName: 'risky_tool_stress', arguments: {} }]
          } as LLMResponse
        }
        if (llmCalls === 2) {
          return {
            stopReason: 'tool_use',
            toolCalls: [{ toolCallId: 'call_safe', toolName: 'dummy_tool', arguments: {} }]
          } as LLMResponse
        }
        return { stopReason: 'end_turn', content: 'Done' } as LLMResponse
      }),
      stream: vi.fn()
    }

    const toolExec: ToolExecutor = {
      execute: async (call, ctx: any) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { toolCallId: call.toolCallId, output: { ok: true, confirmedInteractionId: ctx.confirmedInteractionId }, isError: false } as ToolResult
      },
      recordRejection: (call) => ({ toolCallId: call.toolCallId, output: { isError: true, error: 'User rejected the request' }, isError: true })
    }

    const { conversationStore, manager, taskService, interactionService, toolRegistry } = await createTestInfra(dir, {
      llm: mockLLM,
      toolExecutor: toolExec
    })

    toolRegistry.register({
      name: 'risky_tool_stress',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      group: 'search',
      riskLevel: 'risky',
      execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'done' })
    })

    const { taskId } = await taskService.createTask({ title: 'Stress', agentId: DEFAULT_AGENT_ACTOR_ID })
    manager.start()

    let seed = 1729
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483647
      return seed / 2147483647
    }

    for (let i = 0; i < 40; i += 1) {
      const pending = await interactionService.getPendingInteraction(taskId)
      const r = rand()
      if (pending && r < 0.35) {
        const option = r < 0.18 ? 'approve' : 'reject'
        await interactionService.respondToInteraction(taskId, pending.interactionId, { selectedOptionId: option })
      } else if (r < 0.55) {
        try { await taskService.addInstruction(taskId, `instruction-${i}`) } catch {}
      } else if (r < 0.7) {
        try { await taskService.pauseTask(taskId, `pause-${i}`) } catch {}
      } else if (r < 0.85) {
        try { await taskService.resumeTask(taskId, `resume-${i}`) } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    const pendingFinal = await interactionService.getPendingInteraction(taskId)
    if (pendingFinal) {
      await interactionService.respondToInteraction(taskId, pendingFinal.interactionId, { selectedOptionId: 'approve' })
    }
    try { await taskService.resumeTask(taskId, 'final-resume') } catch {}
    await manager.waitForIdle()

    const messages = await conversationStore.getMessages(taskId)
    const toolIds = new Set<string>()
    for (const message of messages) {
      if (message.role === 'assistant') {
        for (const call of message.toolCalls ?? []) {
          toolIds.add(call.toolCallId)
        }
      }
    }
    for (const toolId of toolIds) {
      expect(messages.some(m => m.role === 'tool' && m.toolCallId === toolId)).toBe(true)
    }
    expect(messages.some(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('interrupted'))).toBe(false)

    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })
})
