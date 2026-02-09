import { describe, it, expect, vi } from 'vitest'
import { DefaultCoAuthorAgent } from '../../src/agents/defaultAgent.js'
import { ContextBuilder } from '../../src/application/contextBuilder.js'
import type { AgentContext } from '../../src/agents/agent.js'
import type { TaskView } from '../../src/application/taskService.js'
import type { ToolRegistry, Tool } from '../../src/domain/ports/tool.js'
import type { LLMClient } from '../../src/domain/ports/llmClient.js'

describe('DefaultCoAuthorAgent Diff Generation', () => {
  const mockStore = {
    readFile: async () => '',
    readFileRange: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    exists: async () => false,
    mkdir: async () => {},
    stat: async () => null,
    deleteFile: async () => {}
  }
  // @ts-ignore
  const contextBuilder = new ContextBuilder('/tmp', mockStore)
  const agent = new DefaultCoAuthorAgent({ contextBuilder })

  const mockTask: TaskView = {
    taskId: 't1',
    title: 'Test Task',
    intent: 'Test',
    createdBy: 'u1',
    agentId: 'a1',
    priority: 'normal',
    status: 'in_progress',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const mockTool: Tool = {
    name: 'editFile',
    description: 'Edit file',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'risky',
    execute: async () => ({ toolCallId: '1', output: {}, isError: false })
  }

  const mockTools: ToolRegistry = {
    register: vi.fn(),
    get: vi.fn().mockReturnValue(mockTool),
    list: vi.fn().mockReturnValue([mockTool]),
    toOpenAIFormat: vi.fn().mockReturnValue([])
  }

  const mockLLM: LLMClient = {
    complete: vi.fn().mockResolvedValue({
      toolCalls: [{
        toolCallId: 'call_1',
        toolName: 'editFile',
        arguments: {
          path: 'test.txt',
          oldString: 'Hello World',
          newString: 'Hello CoAuthor'
        }
      }],
      stopReason: 'tool_use'
    }),
    stream: vi.fn()
  }

  const mockContext: AgentContext = {
    llm: mockLLM,
    tools: mockTools,
    baseDir: '/tmp',
    conversationHistory: [],
    persistMessage: vi.fn()
  }

  it('should yield tool_call for risky editFile (agent is risk-unaware)', async () => {
    const generator = agent.run(mockTask, mockContext)
    
    // 1. Verbose yield (Calling LLM...)
    let result = await generator.next()
    expect(result.value).toMatchObject({ kind: 'verbose' })

    // 2. Verbose yield (Executing tool...)
    result = await generator.next()
    expect(result.value).toMatchObject({ kind: 'verbose', content: expect.stringContaining('Executing tool') })

    // 3. tool_call yield — agent doesn't know about risk, just yields it
    result = await generator.next()
    expect(result.value).toMatchObject({
      kind: 'tool_call',
      call: {
        toolCallId: 'call_1',
        toolName: 'editFile',
        arguments: {
          path: 'test.txt',
          oldString: 'Hello World',
          newString: 'Hello CoAuthor'
        }
      }
    })
  })
})
