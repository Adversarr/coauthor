import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Agent, AgentContext, AgentOutput } from '../src/agents/agent.js'
import type { TaskView } from '../src/application/taskService.js'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { JsonlAuditLog } from '../src/infra/jsonlAuditLog.js'
import { JsonlConversationStore } from '../src/infra/jsonlConversationStore.js'
import { DefaultToolRegistry } from '../src/infra/toolRegistry.js'
import { DefaultToolExecutor } from '../src/infra/toolExecutor.js'
import { TaskService } from '../src/application/taskService.js'
import { InteractionService } from '../src/application/interactionService.js'
import { AgentRuntime } from '../src/agents/runtime.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

class ImmediateDoneAgent implements Agent {
  readonly id: string
  readonly displayName = 'Immediate Done Agent'

  constructor(id: string) {
    this.id = id
  }

  async *run(_task: TaskView, _context: AgentContext): AsyncGenerator<AgentOutput> {
    yield { kind: 'done', summary: 'ok' }
  }
}

class SingleToolCallAgent implements Agent {
  readonly id: string
  readonly displayName = 'Single ToolCall Agent'

  constructor(id: string) {
    this.id = id
  }

  async *run(_task: TaskView, _context: AgentContext): AsyncGenerator<AgentOutput> {
    yield {
      kind: 'tool_call',
      call: {
        toolCallId: 'tc_1',
        toolName: 'safeEcho',
        arguments: { value: 'hello' },
      },
    }
    yield { kind: 'done', summary: 'ok' }
  }
}

describe('AgentRuntime - context recovery', () => {
  test('repairs missing tool result messages using AuditLog ToolCallCompleted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-repair-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl'),
    })
    store.ensureSchema()

    const conversationStore = new JsonlConversationStore({
      conversationsPath: join(dir, 'conversations.jsonl'),
    })
    conversationStore.ensureSchema()

    const auditLog = new JsonlAuditLog({ auditPath: join(dir, 'audit.jsonl') })
    auditLog.ensureSchema()

    const toolRegistry = new DefaultToolRegistry()
    const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })

    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const interactionService = new InteractionService(store, DEFAULT_USER_ACTOR_ID)

    const agent = new ImmediateDoneAgent('agent_repair')
    const runtime = new AgentRuntime({
      store,
      conversationStore,
      auditLog,
      taskService,
      interactionService,
      agent,
      llm: { complete: async () => ({ stopReason: 'end_turn' }), stream: async function* () {} },
      toolRegistry,
      toolExecutor,
      baseDir: dir,
    })

    store.append('t1', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't1',
          title: 'T1',
          intent: '',
          priority: 'foreground',
          agentId: agent.id,
          authorActorId: DEFAULT_USER_ACTOR_ID,
        },
      },
    ])

    conversationStore.append('t1', {
      role: 'assistant',
      toolCalls: [{ toolCallId: 'tc_missing', toolName: 'safeEcho', arguments: { value: 'x' } }],
    })

    auditLog.append({
      type: 'ToolCallCompleted',
      payload: {
        toolCallId: 'tc_missing',
        toolName: 'safeEcho',
        authorActorId: agent.id,
        taskId: 't1',
        output: { ok: true },
        isError: false,
        durationMs: 1,
        timestamp: Date.now(),
      },
    })

    await runtime.executeTask('t1')

    const repairedMessages = conversationStore.getMessages('t1')
    expect(repairedMessages.some((m) => m.role === 'tool' && m.toolCallId === 'tc_missing')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('persists tool results immediately after execution in Runtime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-toolpersist-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl'),
    })
    store.ensureSchema()

    const conversationStore = new JsonlConversationStore({
      conversationsPath: join(dir, 'conversations.jsonl'),
    })
    conversationStore.ensureSchema()

    const auditLog = new JsonlAuditLog({ auditPath: join(dir, 'audit.jsonl') })
    auditLog.ensureSchema()

    const toolRegistry = new DefaultToolRegistry()
    toolRegistry.register({
      name: 'safeEcho',
      description: 'echo',
      parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      riskLevel: 'safe',
      execute: async (args) => ({
        toolCallId: 'ignored_by_executor',
        output: { echoed: args.value },
        isError: false,
      }),
    })
    const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })

    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const interactionService = new InteractionService(store, DEFAULT_USER_ACTOR_ID)

    const agent = new SingleToolCallAgent('agent_toolpersist')
    const runtime = new AgentRuntime({
      store,
      conversationStore,
      auditLog,
      taskService,
      interactionService,
      agent,
      llm: { complete: async () => ({ stopReason: 'end_turn' }), stream: async function* () {} },
      toolRegistry,
      toolExecutor,
      baseDir: dir,
    })

    store.append('t1', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't1',
          title: 'T1',
          intent: '',
          priority: 'foreground',
          agentId: agent.id,
          authorActorId: DEFAULT_USER_ACTOR_ID,
        },
      },
    ])

    await runtime.executeTask('t1')

    const messages = conversationStore.getMessages('t1')
    expect(messages.some((m) => m.role === 'tool' && m.toolCallId === 'tc_1')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })
})

