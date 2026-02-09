import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OutputHandler } from '../../src/agents/outputHandler.js'
import type { Tool, ToolContext } from '../../src/domain/ports/tool.js'
import type { ToolRegistry } from '../../src/domain/ports/tool.js'
import type { ToolExecutor } from '../../src/domain/ports/tool.js'

describe('OutputHandler Tool Lifecycle', () => {
  let handler: OutputHandler
  let mockRegistry: ToolRegistry
  let mockExecutor: ToolExecutor
  let mockConversationManager: any
  
  const ctx = {
    taskId: 't1',
    agentId: 'a1',
    baseDir: '/tmp',
    conversationHistory: [],
    persistMessage: vi.fn()
  }

  beforeEach(() => {
    mockRegistry = {
      get: vi.fn(),
      register: vi.fn(),
      list: vi.fn(),
      toOpenAIFormat: vi.fn()
    }
    mockExecutor = {
      execute: vi.fn().mockResolvedValue({ toolCallId: '1', output: 'done', isError: false }),
      recordRejection: vi.fn((call) => ({ toolCallId: call.toolCallId, output: { isError: true, error: 'User rejected the request' }, isError: true }))
    }
    mockConversationManager = {
      getPendingToolCalls: vi.fn(),
      persistToolResultIfMissing: vi.fn()
    }

    handler = new OutputHandler({
      toolRegistry: mockRegistry,
      toolExecutor: mockExecutor,
      conversationManager: mockConversationManager,
      artifactStore: {} as any
    })
  })

  it('should skip execution if safe tool fails canExecute', async () => {
    const safeTool: Tool = {
      name: 'safe-tool',
      description: 'safe',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'safe',
      canExecute: vi.fn().mockRejectedValue(new Error('Pre-check failed')),
      execute: vi.fn()
    }
    
    vi.mocked(mockRegistry.get).mockReturnValue(safeTool)

    await handler.handle({
      kind: 'tool_call',
      call: { toolCallId: '1', toolName: 'safe-tool', arguments: {} }
    }, ctx)

    expect(safeTool.canExecute).toHaveBeenCalled()
    expect(mockExecutor.execute).not.toHaveBeenCalled()
    expect(mockConversationManager.persistToolResultIfMissing).toHaveBeenCalledWith(
      expect.anything(), '1', 'safe-tool', { error: 'Pre-check failed' }, true, expect.anything(), expect.anything()
    )
  })

  it('should skip approval if risky tool fails canExecute', async () => {
    const riskyTool: Tool = {
      name: 'risky-tool',
      description: 'risky',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'risky',
      canExecute: vi.fn().mockRejectedValue(new Error('Pre-check failed')),
      execute: vi.fn()
    }
    
    vi.mocked(mockRegistry.get).mockReturnValue(riskyTool)

    const result = await handler.handle({
      kind: 'tool_call',
      call: { toolCallId: '1', toolName: 'risky-tool', arguments: {} }
    }, ctx)

    expect(result.pause).toBeUndefined()
    expect(result.event).toBeUndefined()
    expect(mockExecutor.execute).not.toHaveBeenCalled()
  })

  it('should pause for approval if risky tool passes canExecute', async () => {
    const riskyTool: Tool = {
      name: 'risky-tool',
      description: 'risky',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'risky',
      canExecute: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn()
    }
    
    vi.mocked(mockRegistry.get).mockReturnValue(riskyTool)

    const result = await handler.handle({
      kind: 'tool_call',
      call: { toolCallId: '1', toolName: 'risky-tool', arguments: {} }
    }, ctx)

    expect(result.pause).toBe(true)
    expect(result.event?.type).toBe('UserInteractionRequested')
    expect(mockExecutor.execute).not.toHaveBeenCalled()
  })

  it('should execute safe tool if canExecute passes', async () => {
    const safeTool: Tool = {
      name: 'safe-tool',
      description: 'safe',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'safe',
      canExecute: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn()
    }
    
    vi.mocked(mockRegistry.get).mockReturnValue(safeTool)

    await handler.handle({
      kind: 'tool_call',
      call: { toolCallId: '1', toolName: 'safe-tool', arguments: {} }
    }, ctx)

    expect(safeTool.canExecute).toHaveBeenCalled()
    expect(mockExecutor.execute).toHaveBeenCalled()
  })

  it('should record rejection audit entries via handleRejections', async () => {
    const persistMessage = vi.fn()
    const rejectionCtx = {
      taskId: 't1',
      agentId: 'a1',
      baseDir: '/tmp',
      conversationHistory: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { toolCallId: 'tc1', toolName: 'risky-tool', arguments: { path: 'f.txt' } }
          ]
        }
      ],
      persistMessage
    }

    const riskyTool: Tool = {
      name: 'risky-tool',
      description: 'risky',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'risky',
      execute: vi.fn()
    }
    vi.mocked(mockRegistry.get).mockReturnValue(riskyTool)
    vi.mocked(mockConversationManager.getPendingToolCalls).mockReturnValue([
      { toolCallId: 'tc1', toolName: 'risky-tool', arguments: { path: 'f.txt' } }
    ])

    await handler.handleRejections(rejectionCtx, 'tc1')

    // recordRejection should be called for the dangling tool call
    expect(mockExecutor.recordRejection).toHaveBeenCalledWith(
      { toolCallId: 'tc1', toolName: 'risky-tool', arguments: { path: 'f.txt' } },
      expect.objectContaining({ taskId: 't1', actorId: 'a1' })
    )

    // Conversation persistence should happen
    expect(mockConversationManager.persistToolResultIfMissing).toHaveBeenCalledWith(
      't1', 'tc1', 'risky-tool',
      { isError: true, error: 'User rejected the request' },
      true,
      expect.anything(),
      persistMessage
    )
  })

  it('should not call recordRejection when tool result already exists', async () => {
    vi.mocked(mockExecutor.recordRejection).mockClear()

    const rejectionCtx = {
      taskId: 't1',
      agentId: 'a1',
      baseDir: '/tmp',
      conversationHistory: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { toolCallId: 'tc2', toolName: 'risky-tool', arguments: {} }
          ]
        },
        {
          role: 'tool' as const,
          toolCallId: 'tc2',
          content: '{"ok": true}'
        }
      ],
      persistMessage: vi.fn()
    }

    vi.mocked(mockConversationManager.getPendingToolCalls).mockReturnValue([])
    await handler.handleRejections(rejectionCtx, 'tc2')

    // No rejection needed — result already exists
    expect(mockExecutor.recordRejection).not.toHaveBeenCalled()
  })
})
