import { describe, it, expect, vi } from 'vitest'
import { DefaultSeedAgent } from '../../src/agents/implementations/defaultAgent.js'
import { ContextBuilder } from '../../src/application/context/contextBuilder.js'
import type { AgentContext } from '../../src/agents/core/agent.js'
import type { TaskView } from '../../src/application/services/taskService.js'
import type { ToolRegistry, Tool } from '../../src/core/ports/tool.js'
import type { LLMClient } from '../../src/core/ports/llmClient.js'

describe('DefaultSeedAgent Diff Generation', () => {
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
    name: 'editFile',
    description: 'Edit file',
    parameters: { type: 'object', properties: {} },
    group: 'edit',
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
          newString: 'Hello Seed'
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

  it('should yield tool_calls batch for risky editFile (agent is risk-unaware)', async () => {
    const generator = agent.run(mockTask, mockContext)
    
    // 1. Verbose yield (Calling LLM...)
    let result = await generator.next()
    expect(result.value).toMatchObject({ kind: 'verbose' })

    // 2. Verbose yield (Executing tools...)
    result = await generator.next()
    expect(result.value).toMatchObject({ kind: 'verbose', content: expect.stringContaining('Executing tools') })

    // 3. tool_calls batch yield — agent yields all tool calls as a batch
    result = await generator.next()
    expect(result.value).toMatchObject({
      kind: 'tool_calls',
      calls: [{
        toolCallId: 'call_1',
        toolName: 'editFile',
        arguments: {
          path: 'test.txt',
          oldString: 'Hello World',
          newString: 'Hello Seed'
        }
      }]
    })
  })

  it('should yield tool_calls batch in streaming mode too', async () => {
    const streamLLM: LLMClient = {
      complete: vi.fn(),
      stream: vi.fn().mockImplementation(async (_req, onChunk) => {
        onChunk({ type: 'tool_call_start', toolCallId: 'call_stream_1', toolName: 'editFile' })
        onChunk({ type: 'tool_call_end', toolCallId: 'call_stream_1' })
        onChunk({ type: 'done', stopReason: 'tool_use' })
        return {
          toolCalls: [{
            toolCallId: 'call_stream_1',
            toolName: 'editFile',
            arguments: { path: 'test.txt', oldString: 'A', newString: 'B' }
          }],
          stopReason: 'tool_use'
        }
      })
    }

    const streamContext: AgentContext = {
      ...mockContext,
      llm: streamLLM,
      onStreamChunk: vi.fn(),
      getStreamParts: vi.fn().mockReturnValue([]),
    }

    const generator = agent.run(mockTask, streamContext)

    await generator.next() // [Iteration] Calling LLM...
    await generator.next() // Executing tools...
    const result = await generator.next() // tool_calls

    expect(result.value).toMatchObject({
      kind: 'tool_calls',
      calls: [{
        toolCallId: 'call_stream_1',
        toolName: 'editFile',
        arguments: { path: 'test.txt', oldString: 'A', newString: 'B' }
      }]
    })
    expect(streamLLM.stream).toHaveBeenCalled()
    expect(streamLLM.complete).not.toHaveBeenCalled()
  })
})
