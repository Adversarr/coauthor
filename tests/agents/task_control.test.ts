import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { JsonlEventStore } from '../../src/infrastructure/persistence/jsonlEventStore.js'
import { JsonlAuditLog } from '../../src/infrastructure/persistence/jsonlAuditLog.js'
import { JsonlConversationStore } from '../../src/infrastructure/persistence/jsonlConversationStore.js'
import { TaskService } from '../../src/application/services/taskService.js'
import { ContextBuilder } from '../../src/application/context/contextBuilder.js'
import { RuntimeManager } from '../../src/agents/orchestration/runtimeManager.js'
import { ConversationManager } from '../../src/agents/orchestration/conversationManager.js'
import { OutputHandler } from '../../src/agents/orchestration/outputHandler.js'
import { DefaultSeedAgent } from '../../src/agents/implementations/defaultAgent.js'
import { FakeLLMClient } from '../../src/infrastructure/llm/fakeLLMClient.js'
import { DefaultToolRegistry } from '../../src/infrastructure/tools/toolRegistry.js'
import { DefaultToolExecutor } from '../../src/infrastructure/tools/toolExecutor.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import type { LLMClient } from '../../src/core/ports/llmClient.js'

async function createTestInfra(dir: string, opts?: { llm?: LLMClient }) {
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
  const contextBuilder = new ContextBuilder(dir)
  const llm = opts?.llm ?? new FakeLLMClient()
  const agent = new DefaultSeedAgent({ contextBuilder })

  const artifactStore = {
    readFile: async () => '',
    readFileRange: async () => '',
    listDir: async () => [],
    writeFile: async () => {}
  }

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

  return { store, conversationStore, taskService, manager, llm }
}

describe('Task Control & Session', () => {
  test('Pause and Resume updates status and triggers execution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-control-'))

    // Deferred LLM: first call blocks until we release it, allowing us to pause mid-execution
    let releaseLLM!: () => void
    const baseLLM = new FakeLLMClient()
    let callCount = 0
    const deferredLLM: LLMClient = {
      async complete(options) {
        callCount++
        if (callCount === 1) {
          await new Promise<void>(resolve => { releaseLLM = resolve })
        }
        return baseLLM.complete(options)
      },
      stream(options, onChunk) { return baseLLM.stream(options, onChunk) }
    }

    const { store, taskService, manager } = await createTestInfra(dir, { llm: deferredLLM })

    manager.start()

    // 1. Create task
    const { taskId } = await taskService.createTask({
      title: 'Control Task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    // Give the event handler time to start the task (TaskStarted emitted before LLM call)
    await new Promise(r => setTimeout(r, 20))

    // Task should be in_progress (blocked on LLM)
    let task = await taskService.getTask(taskId)
    expect(task?.status).toBe('in_progress')

    // 2. Pause task
    await taskService.pauseTask(taskId, 'Hold on')
    task = await taskService.getTask(taskId)
    expect(task?.status).toBe('paused')

    // Release LLM so first execution finishes
    releaseLLM()
    await manager.waitForIdle()

    // 3. Resume task
    await taskService.resumeTask(taskId, 'Go')
    task = await taskService.getTask(taskId)
    expect(task?.status).toBe('in_progress')

    // Allow runtime to process events
    await manager.waitForIdle()

    // Verify Agent ran (should have TaskCompleted)
    const events = await store.readStream(taskId)
    expect(events.some(e => e.type === 'TaskCompleted')).toBe(true)

    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('Add Instruction to Done task resumes it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-session-'))
    const { store, conversationStore, taskService, manager } = await createTestInfra(dir)

    manager.start()

    // 1. Create and finish task
    const { taskId } = await taskService.createTask({
      title: 'Session Task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await manager.waitForIdle()
    
    let task = await taskService.getTask(taskId)
    expect(task?.status).toBe('done')
    const completedCount1 = (await store.readStream(taskId)).filter(e => e.type === 'TaskCompleted').length
    expect(completedCount1).toBe(1)

    // 2. Add Instruction
    const newInstruction = 'Please refine this'
    await taskService.addInstruction(taskId, newInstruction)

    // Check status updated immediately to in_progress
    task = await taskService.getTask(taskId)
    expect(task?.status).toBe('in_progress')

    // 3. Allow runtime to process
    await manager.waitForIdle()

    // 4. Verify Agent ran again (TaskCompleted count increased)
    const events = await store.readStream(taskId)
    const completedCount2 = events.filter(e => e.type === 'TaskCompleted').length
    expect(completedCount2).toBe(2)

    // 5. Verify conversation history has the instruction
    const messages = await conversationStore.getMessages(taskId)
    const userMessages = messages.filter(m => m.role === 'user')
    // 1st: Initial intent (inserted by ContextBuilder? No, ContextBuilder puts it in System/User prompt).
    // Actually, DefaultAgent puts task intent in the prompt.
    // But conversationStore tracks messages persisted *during* the run.
    // The *new* instruction is explicitly appended to conversationStore by runtime.
    // So we should see it.
    const instructionMsg = userMessages.find(m => m.content === newInstruction)
    expect(instructionMsg).toBeDefined()

    manager.stop()
    rmSync(dir, { recursive: true, force: true })
  })
})
