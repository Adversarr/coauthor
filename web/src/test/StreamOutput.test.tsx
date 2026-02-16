/**
 * StreamOutput tests (live UiEvent feedback + persisted replay transcript).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StreamOutput } from '@/components/panels/StreamOutput'

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
type TestStreamChunk = {
  kind: 'text' | 'reasoning' | 'verbose' | 'error' | 'tool_call' | 'tool_result'
  content: string
  timestamp: number
  toolCallId?: string
  toolName?: string
  toolArguments?: Record<string, unknown>
  isError?: boolean
}
let mockStreams: Record<string, { chunks: TestStreamChunk[]; completed: boolean }> = {}

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

vi.mock('@/stores/streamStore', () => ({
  useStreamStore: vi.fn((selector: (state: {
    streams: Record<string, { chunks: TestStreamChunk[]; completed: boolean }>
  }) => unknown) => selector({
    streams: mockStreams,
  })),
}))

describe('StreamOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessages = []
    mockLoading = false
    mockStreams = {}
    mockFetchConversation.mockResolvedValue(undefined)
  })

  it('renders assistant text/reasoning and tool call/result in chronological order', () => {
    mockMessages = [
      {
        id: 'm-user',
        role: 'user',
        timestamp: new Date().toISOString(),
        parts: [{ kind: 'text', content: 'Please summarize.' }],
      },
      {
        id: 'm-assistant',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        parts: [
          { kind: 'reasoning', content: 'I should condense the content.' },
          { kind: 'tool_call', toolCallId: 'tc-1', toolName: 'search_docs', arguments: { query: 'deployment checklist' } },
          { kind: 'text', content: 'Final replay answer.' },
        ],
      },
      {
        id: 'm-tool',
        role: 'tool',
        timestamp: new Date().toISOString(),
        parts: [{ kind: 'tool_result', toolCallId: 'tc-1', toolName: 'search_docs', content: 'search results' }],
      },
    ]

    render(<StreamOutput taskId="task-1" />)

    expect(mockFetchConversation).toHaveBeenCalledWith('task-1')
    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.getByText('Assistant Reasoning')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Tool Call: search_docs')).toBeInTheDocument()
    expect(screen.getByText('Tool Result: search_docs')).toBeInTheDocument()
    expect(screen.getByText('Please summarize.')).toBeInTheDocument()
    expect(screen.getByText('I should condense the content.')).toBeInTheDocument()
    expect(screen.getByText('Final replay answer.')).toBeInTheDocument()
    expect(screen.getByText(/"query": "deployment checklist"/)).toBeInTheDocument()
    expect(screen.getByText('search results')).toBeInTheDocument()
  })

  it('renders live UiEvent chunks for the active task', () => {
    mockStreams = {
      'task-1': {
        completed: false,
        chunks: [
          { kind: 'text', content: 'Live assistant output', timestamp: 1 },
          { kind: 'tool_call', content: 'Running read_file…', timestamp: 2, toolName: 'read_file', toolArguments: { path: 'README.md' } },
          { kind: 'tool_result', content: 'File contents', timestamp: 3, toolName: 'read_file' },
        ],
      },
    }

    render(<StreamOutput taskId="task-1" />)

    expect(screen.getByText('Live Agent Activity')).toBeInTheDocument()
    expect(screen.getByText('Assistant (Live)')).toBeInTheDocument()
    expect(screen.getByText('Tool Call (Live): read_file')).toBeInTheDocument()
    expect(screen.getByText('Tool Result (Live): read_file')).toBeInTheDocument()
    expect(screen.getByText('Live assistant output')).toBeInTheDocument()
    expect(screen.getByText(/Running read_file/)).toBeInTheDocument()
    expect(screen.getByText(/"path": "README.md"/)).toBeInTheDocument()
    expect(screen.getByText('File contents')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('renders live activity and persisted transcript together', () => {
    mockMessages = [
      {
        id: 'm-assistant',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        parts: [{ kind: 'text', content: 'Persisted assistant answer' }],
      },
    ]
    mockStreams = {
      'task-1': {
        completed: true,
        chunks: [
          { kind: 'text', content: 'Live chunk before persistence', timestamp: 10 },
        ],
      },
    }

    render(<StreamOutput taskId="task-1" />)

    expect(screen.getByText('Live Agent Activity')).toBeInTheDocument()
    expect(screen.getByText('Persisted Transcript')).toBeInTheDocument()
    expect(screen.getByText('Live chunk before persistence')).toBeInTheDocument()
    expect(screen.getByText('Persisted assistant answer')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('shows empty state when conversation is empty', () => {
    mockMessages = []
    mockLoading = false

    render(<StreamOutput taskId="task-1" />)

    expect(screen.getByText('No output transcript available yet.')).toBeInTheDocument()
  })

  it('renders persisted content once across rerenders', () => {
    mockMessages = [
      {
        id: 'm-assistant',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        parts: [{ kind: 'text', content: 'Stable persisted answer' }],
      },
    ]

    const { rerender } = render(<StreamOutput taskId="task-1" />)
    expect(screen.getAllByText('Stable persisted answer')).toHaveLength(1)

    rerender(<StreamOutput taskId="task-1" />)
    expect(screen.getAllByText('Stable persisted answer')).toHaveLength(1)
  })
})
