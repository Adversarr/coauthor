/**
 * ConversationView replay-only rendering tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ConversationView } from '@/components/panels/ConversationView'

type TestConversationMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  timestamp: string
  parts: Array<
    | { kind: 'text'; content: string }
    | { kind: 'reasoning'; content: string }
    | { kind: 'tool_call'; toolCallId: string; toolName: string; arguments: Record<string, unknown> }
    | { kind: 'tool_result'; toolCallId: string; toolName?: string; content: string }
  >
}

const mockFetchConversation = vi.fn()
let mockMessages: TestConversationMessage[] = []
let mockLoading = false

vi.mock('react-router-dom', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}))

vi.mock('@/stores/conversationStore', () => ({
  useConversationStore: vi.fn((selector: (state: {
    getMessages: (taskId: string) => TestConversationMessage[]
    loadingTasks: Set<string>
    fetchConversation: (taskId: string) => Promise<void>
  }) => unknown) => selector({
    getMessages: () => mockMessages,
    loadingTasks: mockLoading ? new Set(['task-1']) : new Set<string>(),
    fetchConversation: mockFetchConversation,
  })),
}))

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: vi.fn((selector: (state: { tasks: Array<{ taskId: string; status: string; summary?: string }> }) => unknown) =>
    selector({ tasks: [] }),
  ),
}))

// Regression guard: ConversationView must not import stream store for rendering.
vi.mock('@/stores/streamStore', () => {
  throw new Error('ConversationView should not import streamStore')
})

vi.mock('@/components/ai-elements/conversation', () => ({
  Conversation: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
  ConversationContent: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
  ConversationScrollButton: () => <button type="button">scroll</button>,
}))

vi.mock('@/components/ai-elements/message', () => ({
  Message: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MessageContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MessageResponse: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ai-elements/reasoning', () => ({
  Reasoning: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ReasoningTrigger: () => <div>reasoning</div>,
  ReasoningContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ai-elements/tool', () => ({
  Tool: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToolHeader: ({ toolName, state }: { toolName: string; state: string }) => <div>{`tool-header:${toolName}:${state}`}</div>,
  ToolContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToolInput: ({ input }: { input: unknown }) => <pre>{`tool-input:${JSON.stringify(input)}`}</pre>,
  ToolOutput: ({ output }: { output: string }) => <pre>{`tool-output:${output}`}</pre>,
}))

vi.mock('@/components/ai-elements/task', () => ({
  Task: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TaskTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TaskContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TaskItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/display/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}))

describe('ConversationView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessages = []
    mockLoading = false
    mockFetchConversation.mockResolvedValue(undefined)
  })

  it('renders persisted conversation and pairs tool result once', async () => {
    mockMessages = [
      {
        id: 'm-user',
        role: 'user',
        timestamp: new Date().toISOString(),
        parts: [{ kind: 'text', content: 'Summarize the current deployment checklist' }],
      },
      {
        id: 'm-assistant',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        parts: [
          { kind: 'reasoning', content: 'Planning summary' },
          { kind: 'tool_call', toolCallId: 'tc-1', toolName: 'search_docs', arguments: { q: 'deployment checklist' } },
          { kind: 'text', content: 'Here is the summary.' },
        ],
      },
      {
        id: 'm-tool',
        role: 'tool',
        timestamp: new Date().toISOString(),
        parts: [{ kind: 'tool_result', toolCallId: 'tc-1', toolName: 'search_docs', content: 'tool result payload' }],
      },
    ]

    render(<ConversationView taskId="task-1" />)

    expect(mockFetchConversation).toHaveBeenCalledWith('task-1')
    expect(screen.getByText('Summarize the current deployment checklist')).toBeInTheDocument()
    expect(screen.getByText('Planning summary')).toBeInTheDocument()
    expect(screen.getByText('Here is the summary.')).toBeInTheDocument()
    expect(screen.getByText('tool-header:search_docs:output-available')).toBeInTheDocument()
    expect(screen.getAllByText('tool-output:tool result payload')).toHaveLength(1)
    expect(screen.queryByText(/thinking…/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/executing…/i)).not.toBeInTheDocument()
  })

  it('shows empty replay state when no conversation exists', () => {
    mockMessages = []
    mockLoading = false

    render(<ConversationView taskId="task-1" />)

    expect(screen.getByText('No conversation yet.')).toBeInTheDocument()
  })
})
