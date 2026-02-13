/**
 * Tests for TaskDetailPage tab layout updates:
 * - Summary is a dedicated tab (not fixed in header)
 * - Default tab remains conversation
 * - Summary tab supports empty/non-empty states
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TaskDetailPage } from '@/pages/TaskDetailPage'
import type { TaskView } from '@/types'
import type { ReactNode } from 'react'

const mockNavigate = vi.fn()
const mockFetchTask = vi.fn()
const mockGetPendingInteraction = vi.fn()

let mockTasks: TaskView[] = []

vi.mock('react-router-dom', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => mockNavigate,
  useParams: () => ({ taskId: 'task-1' }),
}))

vi.mock('@/stores', () => ({
  useTaskStore: vi.fn((selector: (state: { tasks: TaskView[]; fetchTask: typeof mockFetchTask }) => unknown) =>
    selector({ tasks: mockTasks, fetchTask: mockFetchTask })
  ),
}))

vi.mock('@/services/api', () => ({
  api: {
    getPendingInteraction: (...args: unknown[]) => mockGetPendingInteraction(...args),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    cancelTask: vi.fn(),
  },
}))

vi.mock('@/components/ui/tabs', async () => {
  const React = await import('react')
  type TabsContextValue = {
    value: string
    onValueChange?: (value: string) => void
  }
  const TabsContext = React.createContext<TabsContextValue>({ value: '' })

  return {
    Tabs: ({
      value,
      onValueChange,
      className,
      children,
    }: {
      value: string
      onValueChange?: (value: string) => void
      className?: string
      children: ReactNode
    }) => (
      <div className={className}>
        <TabsContext.Provider value={{ value, onValueChange }}>
          {children}
        </TabsContext.Provider>
      </div>
    ),
    TabsList: ({ className, children }: { className?: string; children: ReactNode }) => (
      <div role="tablist" className={className}>{children}</div>
    ),
    TabsTrigger: ({
      value,
      className,
      children,
    }: {
      value: string
      className?: string
      children: ReactNode
    }) => {
      const ctx = React.useContext(TabsContext)
      const selected = ctx.value === value
      return (
        <button
          type="button"
          role="tab"
          aria-selected={selected}
          className={className}
          onClick={() => ctx.onValueChange?.(value)}
        >
          {children}
        </button>
      )
    },
    TabsContent: ({
      value,
      className,
      children,
    }: {
      value: string
      className?: string
      children: ReactNode
    }) => {
      const ctx = React.useContext(TabsContext)
      if (ctx.value !== value) return null
      return <div role="tabpanel" className={className}>{children}</div>
    },
  }
})

vi.mock('@/components/panels/ConversationView', () => ({
  ConversationView: () => <div data-testid="conversation-view">Conversation View</div>,
}))

vi.mock('@/components/panels/PromptBar', () => ({
  PromptBar: () => <div data-testid="prompt-bar">Prompt Bar</div>,
}))

vi.mock('@/components/panels/StreamOutput', () => ({
  StreamOutput: () => <div data-testid="stream-output">Stream Output</div>,
}))

vi.mock('@/components/panels/EventTimeline', () => ({
  EventTimeline: () => <div data-testid="event-timeline">Event Timeline</div>,
}))

vi.mock('@/components/panels/InteractionPanel', () => ({
  InteractionPanel: () => <div data-testid="interaction-panel">Interaction Panel</div>,
}))

vi.mock('@/components/display/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}))

vi.mock('@/components/display/PriorityIcon', () => ({
  PriorityIcon: ({ priority }: { priority: string }) => <span>{priority}</span>,
}))

function makeTask(overrides: Partial<TaskView> = {}): TaskView {
  return {
    taskId: 'task-1',
    title: 'Test Task',
    intent: 'Test intent',
    createdBy: 'user-1',
    agentId: 'agent-1',
    priority: 'normal',
    status: 'in_progress',
    createdAt: '2026-02-10T10:00:00.000Z',
    updatedAt: '2026-02-10T10:00:00.000Z',
    ...overrides,
  }
}

describe('TaskDetailPage tab layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPendingInteraction.mockResolvedValue(null)
    mockTasks = [makeTask({ summary: 'Final summary from agent output.' })]
  })

  it('defaults to conversation tab and renders summary tab trigger', async () => {
    render(<TaskDetailPage />)

    expect(screen.getByRole('tab', { name: /Conversation/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Output/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Events/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Summary/i })).toBeInTheDocument()

    expect(screen.getByTestId('conversation-view')).toBeInTheDocument()
    expect(screen.getByTestId('prompt-bar')).toBeInTheDocument()
  })

  it('shows task summary only when summary tab is selected', async () => {
    render(<TaskDetailPage />)

    expect(screen.queryByText('Final summary from agent output.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Summary/i }))

    const summaryText = await screen.findByText('Final summary from agent output.')
    expect(screen.getByRole('tab', { name: /Summary/i })).toHaveAttribute('aria-selected', 'true')
    expect(summaryText).toBeVisible()
    expect(screen.getByText('Final summary from agent output.')).toBeVisible()
  })

  it('shows empty summary state when task has no summary', async () => {
    mockTasks = [makeTask({ summary: undefined })]

    render(<TaskDetailPage />)

    fireEvent.click(screen.getByRole('tab', { name: /Summary/i }))

    expect(await screen.findByText('No summary available yet.')).toBeVisible()
  })
})
