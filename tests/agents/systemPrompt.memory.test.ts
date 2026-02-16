import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { DefaultSeedAgent } from '../../src/agents/implementations/defaultAgent.js'
import { DEFAULT_SEED_SYSTEM_PROMPT } from '../../src/agents/implementations/templates.js'
import { ContextBuilder } from '../../src/application/context/contextBuilder.js'
import { FsArtifactStore } from '../../src/infrastructure/filesystem/fsArtifactStore.js'
import type { AgentContext } from '../../src/agents/core/agent.js'
import type { TaskView } from '../../src/application/services/taskService.js'
import type { LLMClient } from '../../src/core/ports/llmClient.js'
import type { ToolRegistry } from '../../src/core/ports/tool.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'

function createTask(overrides: Partial<TaskView> = {}): TaskView {
  return {
    taskId: 'task_1',
    title: 'Prompt check',
    intent: 'Verify seeded system prompt',
    createdBy: DEFAULT_USER_ACTOR_ID,
    agentId: 'agent_seed_coordinator',
    priority: 'foreground',
    status: 'open',
    createdAt: '2026-02-02T00:00:00Z',
    updatedAt: '2026-02-02T00:00:00Z',
    ...overrides
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

function createLLMClient() {
  const response = { content: 'done', stopReason: 'end_turn' as const }
  const llm: LLMClient = {
    label: 'test',
    description: 'test',
    complete: vi.fn(async () => response),
    stream: vi.fn(async () => response)
  }
  return llm
}

describe('DefaultSeedAgent system prompt memory', () => {
  test('injects AGENTS.md content and omits legacy project sections', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-system-prompt-'))
    writeFileSync(join(dir, 'AGENTS.md'), '# Agent Memory\n- Rule A\n- Rule B', 'utf8')

    const store = new FsArtifactStore(dir)
    const contextBuilder = new ContextBuilder(dir, store)
    const agent = new DefaultSeedAgent({ contextBuilder })
    const llm = createLLMClient()
    const conversationHistory: any[] = []

    const context: AgentContext = {
      llm,
      tools: createToolRegistry(),
      baseDir: dir,
      conversationHistory,
      persistMessage: async (message) => {
        conversationHistory.push(message)
      }
    }

    for await (const _output of agent.run(createTask(), context)) {
      // Consume output until completion.
    }

    expect(conversationHistory[0]?.role).toBe('system')
    expect(conversationHistory[0]?.content).toContain('## Project Memory (AGENTS.md)')
    expect(conversationHistory[0]?.content).toContain('- Rule A')
    expect(conversationHistory[0]?.content).not.toContain('## Project Outline')
    expect(conversationHistory[0]?.content).not.toContain('## Project Brief')
    expect(conversationHistory[0]?.content).not.toContain('## Style Guide')

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('DEFAULT_SEED_SYSTEM_PROMPT subtask instructions', () => {
  test('documents viable sub-agents and no wait modes', () => {
    expect(DEFAULT_SEED_SYSTEM_PROMPT).toContain('listSubtask: list viable sub-agents in the current top-level group.')
    expect(DEFAULT_SEED_SYSTEM_PROMPT).toContain('createSubtasks accepts tasks: [{ agentId, title, intent?, priority? }].')
    expect(DEFAULT_SEED_SYSTEM_PROMPT).not.toContain('optional wait')
    expect(DEFAULT_SEED_SYSTEM_PROMPT).not.toContain('"all" | "none"')
  })
})
