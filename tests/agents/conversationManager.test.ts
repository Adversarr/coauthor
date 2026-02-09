import { describe, it, expect } from 'vitest'
import { ConversationManager } from '../../src/agents/conversationManager.js'
import type { LLMMessage } from '../../src/domain/ports/llmClient.js'
import type { ToolCallRequest } from '../../src/domain/ports/tool.js'

describe('ConversationManager', () => {
  // Minimal mock setup
  const mockStore = {} as any
  const mockAudit = {} as any
  const mockRegistry = {} as any
  const mockExecutor = {} as any
  const mockArtifacts = {} as any

  const manager = new ConversationManager({
    conversationStore: mockStore,
    auditLog: mockAudit,
    toolRegistry: mockRegistry,
    toolExecutor: mockExecutor,
    artifactStore: mockArtifacts
  })

  describe('getPendingToolCalls', () => {
    it('returns empty array for empty history', () => {
      expect(manager.getPendingToolCalls([])).toEqual([])
    })

    it('returns empty array if no assistant message', () => {
      const history: LLMMessage[] = [
        { role: 'user', content: 'hello' }
      ]
      expect(manager.getPendingToolCalls(history)).toEqual([])
    })

    it('returns empty array if assistant message has no tools', () => {
      const history: LLMMessage[] = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' }
      ]
      expect(manager.getPendingToolCalls(history)).toEqual([])
    })

    it('returns all tools if none are handled', () => {
      const tools: ToolCallRequest[] = [
        { toolCallId: 'call_1', toolName: 't1', arguments: {} },
        { toolCallId: 'call_2', toolName: 't2', arguments: {} }
      ]
      const history: LLMMessage[] = [
        { role: 'user', content: 'do tools' },
        { role: 'assistant', toolCalls: tools }
      ]
      expect(manager.getPendingToolCalls(history)).toEqual(tools)
    })

    it('returns only unhandled tools', () => {
      const tools: ToolCallRequest[] = [
        { toolCallId: 'call_1', toolName: 't1', arguments: {} },
        { toolCallId: 'call_2', toolName: 't2', arguments: {} }
      ]
      const history: LLMMessage[] = [
        { role: 'user', content: 'do tools' },
        { role: 'assistant', toolCalls: tools },
        { role: 'tool', toolCallId: 'call_1', content: 'ok', toolName: 't1' }
      ]
      expect(manager.getPendingToolCalls(history)).toEqual([tools[1]])
    })

    it('returns empty array if all tools handled', () => {
      const tools: ToolCallRequest[] = [
        { toolCallId: 'call_1', toolName: 't1', arguments: {} },
        { toolCallId: 'call_2', toolName: 't2', arguments: {} }
      ]
      const history: LLMMessage[] = [
        { role: 'user', content: 'do tools' },
        { role: 'assistant', toolCalls: tools },
        { role: 'tool', toolCallId: 'call_1', content: 'ok', toolName: 't1' },
        { role: 'tool', toolCallId: 'call_2', content: 'ok', toolName: 't2' }
      ]
      expect(manager.getPendingToolCalls(history)).toEqual([])
    })

    it('ignores handled tools from previous turns', () => {
       // This tests that we only look at the LAST assistant message
       const turn1Tools: ToolCallRequest[] = [
         { toolCallId: 'call_1', toolName: 't1', arguments: {} }
       ]
       const turn2Tools: ToolCallRequest[] = [
         { toolCallId: 'call_2', toolName: 't2', arguments: {} }
       ]
       
       const history: LLMMessage[] = [
         { role: 'assistant', toolCalls: turn1Tools },
         { role: 'tool', toolCallId: 'call_1', content: 'ok', toolName: 't1' },
         { role: 'assistant', toolCalls: turn2Tools }
       ]
       
       expect(manager.getPendingToolCalls(history)).toEqual(turn2Tools)
    })
  })
})
