import { describe, it, expect, vi } from 'vitest'
import { DefaultSeedAgent } from '../../src/agents/implementations/defaultAgent.js'
import { ContextBuilder } from '../../src/application/context/contextBuilder.js'
import type { AgentContext } from '../../src/agents/core/agent.js'
import type { TaskView } from '../../src/application/services/taskService.js'
import type { ToolRegistry, Tool } from '../../src/core/ports/tool.js'
import type { LLMClient, LLMMessage } from '../../src/core/ports/llmClient.js'

describe('DefaultSeedAgent - Risk-Unaware Behavior', () => {
  const contextBuilder = new ContextBuilder('/tmp', {
    readFile: async () => '',
    readFileRange: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    exists: async () => false,
    mkdir: async () => {},
    stat: async () => null
  })
  const agent = new DefaultSeedAgent({ contextBuilder })

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
    name: 'riskyTool',
    description: 'Risky tool',
    parameters: { type: 'object', properties: {} },
    group: 'search',
    riskLevel: 'risky',
    execute: async () => ({ toolCallId: '1', output: { executed: true }, isError: false })
  }

  const mockTools: ToolRegistry = {
    register: vi.fn(),
    get: vi.fn().mockReturnValue(mockTool),
    list: vi.fn().mockReturnValue([mockTool]),
    toOpenAIFormat: vi.fn().mockReturnValue([])
  }

  const mockLLM: LLMClient = {
    complete: vi.fn().mockResolvedValue({
      toolCalls: [],
      content: 'Done'
    }),
    stream: vi.fn()
  }

  it('should skip pending tool calls that already have rejection results (injected by Runtime)', async () => {
    // Runtime injects rejection results before calling agent.run(),
    // so history already contains the tool result when agent sees it.
    const history: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { 
        role: 'assistant', 
        toolCalls: [{
          toolCallId: 'call_1',
          toolName: 'riskyTool',
          arguments: {}
        }]
      },
      {
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'riskyTool',
        content: JSON.stringify({ isError: true, error: 'User rejected the request' })
      }
    ]

    const persistMessage = vi.fn()

    const mockContext: AgentContext = {
      llm: mockLLM,
      tools: mockTools,
      baseDir: '/tmp',
      conversationHistory: history,
      persistMessage
    }

    const generator = agent.run(mockTask, mockContext)

    // The pending call already has a result → agent skips it and enters LLM loop
    const result1 = await generator.next()
    expect(result1.value).toMatchObject({ kind: 'verbose', content: expect.stringContaining('Iteration') })
  })

  it('should yield tool_call for pending risky tool (risk-unaware)', async () => {
    // History has a dangling risky tool call with no result
    const history: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { 
        role: 'assistant', 
        toolCalls: [{
          toolCallId: 'call_1',
          toolName: 'riskyTool',
          arguments: {}
        }]
      }
    ]

    const persistMessage = vi.fn()

    const mockContext: AgentContext = {
      llm: mockLLM,
      tools: mockTools,
      baseDir: '/tmp',
      conversationHistory: history,
      persistMessage
    }

    const generator = agent.run(mockTask, mockContext)

    // Pending tool calls are handled by AgentRuntime, not by the agent.
    // When invoked directly, the agent proceeds to the LLM loop.
    const result1 = await generator.next()
    expect(result1.value).toMatchObject({ kind: 'verbose', content: expect.stringContaining('Iteration') })
  })
})
