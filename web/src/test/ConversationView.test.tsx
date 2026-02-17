/**
 * ConversationView replay-only rendering tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
  ToolHeader: ({
    toolName,
    state,
    title,
    summary,
  }: {
    toolName: string
    state: string
    title?: string
    summary?: string
  }) => (
    <div>
      <div>{`tool-header:${title ?? toolName}:${state}`}</div>
      {summary ? <div>{`tool-summary:${summary}`}</div> : null}
    </div>
  ),
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

  it('truncates long system message and toggles show all/show less', () => {
    const longSystemText = `System instructions: ${'A'.repeat(360)}`
    mockMessages = [
      {
        id: 'm-system',
        role: 'system',
        timestamp: new Date().toISOString(),
        parts: [{ kind: 'text', content: longSystemText }],
      },
    ]

    render(<ConversationView taskId="task-1" />)

    expect(screen.getByRole('button', { name: 'Show all' })).toBeInTheDocument()
    expect(screen.queryByText(longSystemText)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getByText(longSystemText)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })

  it('renders friendly internal tool states for running, success, and failure', () => {
    mockMessages = [
      {
        id: 'm-assistant-tools',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        parts: [
          { kind: 'tool_call', toolCallId: 'tc-running', toolName: 'runCommand', arguments: { command: 'npm test' } },
          { kind: 'tool_call', toolCallId: 'tc-success', toolName: 'readFile', arguments: { path: 'private:/README.md' } },
          { kind: 'tool_call', toolCallId: 'tc-error', toolName: 'runCommand', arguments: { command: 'exit 1' } },
        ],
      },
      {
        id: 'm-tool-success',
        role: 'tool',
        timestamp: new Date().toISOString(),
        parts: [{
          kind: 'tool_result',
          toolCallId: 'tc-success',
          toolName: 'readFile',
          content: JSON.stringify({ path: 'private:/README.md', lineCount: 42 }),
        }],
      },
      {
        id: 'm-tool-error',
        role: 'tool',
        timestamp: new Date().toISOString(),
        parts: [{
          kind: 'tool_result',
          toolCallId: 'tc-error',
          toolName: 'runCommand',
          content: JSON.stringify({ error: 'Command failed', exitCode: 1 }),
        }],
      },
    ]

    render(<ConversationView taskId="task-1" />)

    expect(screen.getByText('tool-header:Run Command:input-available')).toBeInTheDocument()
    expect(screen.getByText('tool-header:Read File:output-available')).toBeInTheDocument()
    expect(screen.getByText('tool-header:Run Command:output-error')).toBeInTheDocument()
    expect(screen.getByText('tool-summary:"npm test"')).toBeInTheDocument()
    expect(screen.getByText('tool-summary:private:/README.md')).toBeInTheDocument()
    expect(screen.getByText('Result: Read private:/README.md (42 lines)')).toBeInTheDocument()
  })

  it('shows compact collapsed summary for web search without duplicating tool name', () => {
    mockMessages = [
      {
        id: 'm-assistant-web-search',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        parts: [
          {
            kind: 'tool_call',
            toolCallId: 'tc-web-search',
            toolName: 'web_search',
            arguments: { query: 'Qwen 3.5 发布时间 参数规模 性能跑分 能力特性 适用场景 相比主流模型优势' },
          },
        ],
      },
    ]

    render(<ConversationView taskId="task-1" />)

    expect(screen.getByText('tool-header:Web Search:input-available')).toBeInTheDocument()
    expect(
      screen.getByText('tool-summary:Qwen 3.5 发布时间 参数规模 性能跑分 能力特性 适用场景 相比主流模型优势')
    ).toBeInTheDocument()
    expect(screen.queryByText(/tool-summary:Web search/i)).not.toBeInTheDocument()
  })

  it('groups consecutive successful same internal tool calls in one assistant turn', () => {
    mockMessages = [
      {
        id: 'm-assistant-grouped',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        parts: [
          { kind: 'tool_call', toolCallId: 'tc-1', toolName: 'readFile', arguments: { path: 'private:/a.ts' } },
          { kind: 'tool_call', toolCallId: 'tc-2', toolName: 'readFile', arguments: { path: 'private:/b.ts' } },
          { kind: 'text', content: 'done' },
        ],
      },
      {
        id: 'm-tool-1',
        role: 'tool',
        timestamp: new Date().toISOString(),
        parts: [{
          kind: 'tool_result',
          toolCallId: 'tc-1',
          toolName: 'readFile',
          content: JSON.stringify({ path: 'private:/a.ts', lineCount: 10 }),
        }],
      },
      {
        id: 'm-tool-2',
        role: 'tool',
        timestamp: new Date().toISOString(),
        parts: [{
          kind: 'tool_result',
          toolCallId: 'tc-2',
          toolName: 'readFile',
          content: JSON.stringify({ path: 'private:/b.ts', lineCount: 12 }),
        }],
      },
    ]

    render(<ConversationView taskId="task-1" />)

    expect(screen.getByText('tool-header:Read File × 2:output-available')).toBeInTheDocument()
    expect(screen.getByText('tool-summary:private:/a.ts | private:/b.ts')).toBeInTheDocument()
    expect(screen.getByText('Call 1')).toBeInTheDocument()
    expect(screen.getByText('Call 2')).toBeInTheDocument()
    expect(screen.getByText('done')).toBeInTheDocument()
  })

  it('falls back to generic rendering for legacy create_subtask tool names', () => {
    mockMessages = [
      {
        id: 'm-assistant-legacy',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        parts: [
          {
            kind: 'tool_call',
            toolCallId: 'tc-legacy',
            toolName: 'create_subtask_agent_research',
            arguments: { title: 'Legacy subtask title' }
          },
        ],
      },
      {
        id: 'm-tool-legacy',
        role: 'tool',
        timestamp: new Date().toISOString(),
        parts: [{
          kind: 'tool_result',
          toolCallId: 'tc-legacy',
          toolName: 'create_subtask_agent_research',
          content: JSON.stringify({ taskId: 'child-1', summary: 'legacy output' }),
        }],
      },
    ]

    render(<ConversationView taskId="task-1" />)

    expect(screen.getByText('tool-header:create_subtask_agent_research:output-available')).toBeInTheDocument()
    expect(screen.queryByText(/Agent: agent_research/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/View full details/i)).not.toBeInTheDocument()
  })
})
