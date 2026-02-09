import { describe, it, expect } from 'vitest'
import type { LLMMessage } from '../src/domain/ports/llmClient.js'
import { buildReplayEntries } from '../src/tui/commands.js'

describe('buildReplayEntries', () => {
  it('formats assistant tool calls with readable payload', () => {
    const message: LLMMessage = {
      role: 'assistant',
      toolCalls: [
        { toolName: 'listFiles', arguments: { path: '.' } }
      ]
    }
    const entries = buildReplayEntries(message)
    expect(entries).toHaveLength(1)
    expect(entries[0].variant).toBe('plain')
    expect(entries[0].content).toContain('listFiles')
    expect(entries[0].content).toContain('"path": "."')
  })

  it('includes reasoning and content when present', () => {
    const message: LLMMessage = {
      role: 'assistant',
      reasoning: 'step-by-step reasoning',
      content: 'hello'
    }
    const entries = buildReplayEntries(message)
    expect(entries).toHaveLength(2)
    expect(entries[0].content).toBe('step-by-step reasoning')
    expect(entries[1].content).toBe('hello')
  })
})
