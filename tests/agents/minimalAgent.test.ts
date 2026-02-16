import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { MinimalAgent } from '../../src/agents/implementations/minimalAgent.js'
import { ContextBuilder } from '../../src/application/context/contextBuilder.js'
import { FsArtifactStore } from '../../src/infrastructure/filesystem/fsArtifactStore.js'
import type { AgentContext } from '../../src/agents/core/agent.js'
import type { TaskView } from '../../src/application/services/taskService.js'
import type { LLMClient, LLMResponse } from '../../src/core/ports/llmClient.js'
import type { ToolRegistry } from '../../src/core/ports/tool.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'

function createTask(overrides: Partial<TaskView> = {}): TaskView {
  return {
    taskId: 'task_1',
    title: 'Minimal Task',
    intent: 'Answer directly',
    createdBy: DEFAULT_USER_ACTOR_ID,
    agentId: 'agent_seed_chat',
    priority: 'foreground',
    status: 'open',
    createdAt: '2026-02-02T00:00:00Z',
    updatedAt: '2026-02-02T00:00:00Z',
    ...overrides
  }
}

function createLLMClient(response: LLMResponse): LLMClient {
  return {
    label: 'test',
    description: 'test',
    complete: vi.fn(async () => response),
    stream: vi.fn(async () => response)
  }
}

function createToolRegistry(): ToolRegistry {
  return {
    register: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    listByGroups: vi.fn().mockReturnValue([]),
    toOpenAIFormat: vi.fn().mockReturnValue([]),
    toOpenAIFormatByGroups: vi.fn().mockReturnValue([])
  }
}

describe('MinimalAgent', () => {
  test('seeds system and user messages on first run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const store = new FsArtifactStore(dir)
    const contextBuilder = new ContextBuilder(dir, store)
    const agent = new MinimalAgent({ contextBuilder })

    const conversationHistory: any[] = []
    const llm = createLLMClient({ content: 'Hello', stopReason: 'end_turn' })

    const context: AgentContext = {
      llm,
      tools: createToolRegistry(),
      baseDir: dir,
      conversationHistory,
      persistMessage: async (message) => {
        conversationHistory.push(message)
      }
    }

    const outputs: any[] = []
    for await (const output of agent.run(createTask(), context)) {
      outputs.push(output)
    }

    expect(outputs.some((o) => o.kind === 'text' && o.content === 'Hello')).toBe(true)
    expect(outputs.some((o) => o.kind === 'done')).toBe(true)

    const roles = conversationHistory.map((m) => m.role)
    expect(roles).toEqual(['system', 'user', 'assistant'])
    expect(conversationHistory[0].content).toContain(dir)
    expect(conversationHistory[0].content).toContain(process.platform)

    rmSync(dir, { recursive: true, force: true })
  })

  test('does not reseed when conversation history exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const store = new FsArtifactStore(dir)
    const contextBuilder = new ContextBuilder(dir, store)
    const agent = new MinimalAgent({ contextBuilder })

    const conversationHistory: any[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'user' }
    ]

    const llm = createLLMClient({ content: 'Reply', stopReason: 'end_turn' })

    const context: AgentContext = {
      llm,
      tools: createToolRegistry(),
      baseDir: dir,
      conversationHistory,
      persistMessage: async (message) => {
        conversationHistory.push(message)
      }
    }

    const outputs: any[] = []
    for await (const output of agent.run(createTask(), context)) {
      outputs.push(output)
    }

    expect(outputs.some((o) => o.kind === 'text' && o.content === 'Reply')).toBe(true)
    expect(conversationHistory.length).toBe(3)
    expect(conversationHistory[2].role).toBe('assistant')

    rmSync(dir, { recursive: true, force: true })
  })
})
