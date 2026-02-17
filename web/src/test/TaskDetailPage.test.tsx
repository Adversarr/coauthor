/**
 * TaskDetailPage tests for replay-only task detail behavior.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskDetailPage } from '@/pages/TaskDetailPage'
import type { TaskView } from '@/types'
import type { ReactNode } from 'react'

const mockNavigate = vi.fn()
const mockFetchTask = vi.fn()
const mockFetchTasks = vi.fn()
const mockGetPendingInteraction = vi.fn()
const mockCreateTaskGroup = vi.fn()

let mockTasks: TaskView[] = []
let mockRouteTaskId = 'task-1'

vi.mock('react-router-dom', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => mockNavigate,
  useParams: () => ({ taskId: mockRouteTaskId }),
}))

vi.mock('@/stores', () => ({
  useTaskStore: vi.fn((selector: (state: {
    tasks: TaskView[]
    fetchTask: typeof mockFetchTask
    fetchTasks: typeof mockFetchTasks
  }) => unknown) =>
    selector({ tasks: mockTasks, fetchTask: mockFetchTask, fetchTasks: mockFetchTasks }),
  ),
}))

vi.mock('@/services/api', () => ({
  api: {
    getPendingInteraction: (...args: unknown[]) => mockGetPendingInteraction(...args),
    createTaskGroup: (...args: unknown[]) => mockCreateTaskGroup(...args),
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
  ConversationView: () => (
    <div data-testid="conversation-view">Conversation View</div>
  ),
}))

vi.mock('@/components/panels/PromptBar', () => ({
  PromptBar: ({ disabled = false }: { disabled?: boolean }) => (
    <div data-testid="prompt-bar" data-disabled={String(disabled)}>Prompt Bar</div>
  ),
}))

vi.mock('@/components/panels/StreamOutput', () => ({
  StreamOutput: () => <div data-testid="replay-output">Replay Output</div>,
}))

vi.mock('@/components/panels/EventTimeline', () => ({
  EventTimeline: () => <div data-testid="event-timeline">Event Timeline</div>,
}))

vi.mock('@/components/dialogs/CreateTaskGroupDialog', () => ({
  CreateTaskGroupDialog: ({
    open,
    onCreate,
  }: {
    open: boolean
    onCreate: (tasks: Array<{ agentId: string; title: string; intent?: string; priority?: string }>) => Promise<void>
  }) => (
    open ? (
      <button
        type="button"
        data-testid="create-group-submit"
        onClick={() => {
          void onCreate([
            {
              agentId: 'agent-2',
              title: 'Subtask from dialog',
              intent: 'Investigate group behavior',
              priority: 'normal'
            }
          ])
        }}
      >
        Submit Group
      </button>
    ) : null
  ),
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

describe('TaskDetailPage replay-only tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteTaskId = 'task-1'
    mockGetPendingInteraction.mockResolvedValue(null)
    mockFetchTasks.mockResolvedValue(undefined)
    mockCreateTaskGroup.mockResolvedValue({ groupId: 'task-1', tasks: [{ taskId: 'task-2', agentId: 'agent-2', title: 'Subtask from dialog' }] })
    mockTasks = [makeTask({ summary: 'Final summary from agent output.' })]
  })

  it('defaults to conversation tab and renders tab order with cooperation', async () => {
    render(<TaskDetailPage />)

    const tabs = screen.getAllByRole('tab').map(tab => tab.textContent?.trim())
    expect(tabs).toEqual([
      'Conversation',
      'Cooperation',
      'Output',
      'Events',
      'Summary',
    ])
    expect(screen.getByRole('tab', { name: /Conversation/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Cooperation/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Output/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Events/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Summary/i })).toBeInTheDocument()

    expect(screen.getByTestId('conversation-view')).toBeInTheDocument()
    expect(screen.getByTestId('prompt-bar')).toBeInTheDocument()
  })

  it('always shows root task link in header metadata', async () => {
    mockTasks = [makeTask({ taskId: 'task-1', title: 'Root Task' })]

    render(<TaskDetailPage />)

    const rootLink = screen.getByText('Root Task', { selector: 'a' })
    expect(rootLink).toHaveAttribute('to', '/tasks/task-1')
    expect(screen.getByText('Root task:')).toBeInTheDocument()
  })

  it('shows replay output panel in output tab', async () => {
    render(<TaskDetailPage />)

    fireEvent.click(screen.getByRole('tab', { name: /Output/i }))

    expect(await screen.findByTestId('replay-output')).toBeInTheDocument()
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

  it('keeps prompt enabled and hides cancel action for done tasks', async () => {
    mockTasks = [makeTask({ status: 'done', summary: 'Done summary' })]

    render(<TaskDetailPage />)

    expect(await screen.findByTestId('prompt-bar')).toHaveAttribute('data-disabled', 'false')
    expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument()
  })

  it('fetches pending interaction once for a stable pendingInteractionId', async () => {
    mockTasks = [makeTask({ pendingInteractionId: 'pi-1' })]
    mockGetPendingInteraction.mockResolvedValue({
      interactionId: 'pi-1',
      taskId: 'task-1',
      kind: 'Input',
      purpose: 'Need input',
      display: { title: 'Input needed' },
      options: [],
    })

    render(<TaskDetailPage />)

    await waitFor(() => expect(mockGetPendingInteraction).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(mockGetPendingInteraction).toHaveBeenCalledTimes(1)
  })

  it('renders replay conversation path exactly once', async () => {
    render(<TaskDetailPage />)

    expect(await screen.findAllByTestId('conversation-view')).toHaveLength(1)
  })

  it('renders todo queue with pending/completed sections and counts', async () => {
    mockTasks = [makeTask({
      todos: [
        { id: 'todo-1', title: 'Write tests', status: 'pending' },
        { id: 'todo-2', title: 'Ship release', status: 'completed' }
      ]
    })]

    render(<TaskDetailPage />)

    expect(screen.getByText('Todo Queue')).toBeInTheDocument()
    expect(screen.getByText('1 Pending')).toBeInTheDocument()
    expect(screen.getByText('1 Completed')).toBeInTheDocument()
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText('Ship release')).toBeInTheDocument()
  })

  it('renders empty todo queue messages when no todos exist', async () => {
    mockTasks = [makeTask({ todos: undefined })]

    render(<TaskDetailPage />)

    const trigger = screen.getByRole('button', { name: /Todo Queue/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)

    expect(screen.getByText('No pending todos.')).toBeInTheDocument()
    expect(screen.getByText('No completed todos.')).toBeInTheDocument()
  })

  it('auto-collapses todo queue when all todos are completed', async () => {
    mockTasks = [makeTask({
      todos: [
        { id: 'todo-1', title: 'Done item', status: 'completed' },
      ]
    })]

    render(<TaskDetailPage />)

    const trigger = screen.getByRole('button', { name: /Todo Queue/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)

    expect(screen.getByText('Done item')).toBeInTheDocument()
  })

  it('renders agent group section for root tasks and allows creating group members', async () => {
    mockTasks = [
      makeTask({ taskId: 'task-1', title: 'Root Task' }),
      makeTask({
        taskId: 'task-2',
        title: 'Child Task',
        parentTaskId: 'task-1',
        status: 'open',
      }),
    ]

    render(<TaskDetailPage />)

    expect(screen.queryByText('Agent Group')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Cooperation/i }))

    expect(screen.getByText('Agent Group')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create Group Members/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Create Group Members/i }))
    fireEvent.click(screen.getByTestId('create-group-submit'))

    await waitFor(() => {
      expect(mockCreateTaskGroup).toHaveBeenCalledWith('task-1', {
        tasks: [
          {
            agentId: 'agent-2',
            title: 'Subtask from dialog',
            intent: 'Investigate group behavior',
            priority: 'normal'
          }
        ]
      })
    })
    expect(mockFetchTasks).toHaveBeenCalled()
  })

  it('shows group context for child tasks but hides root-only create action', async () => {
    mockTasks = [
      makeTask({ taskId: 'task-1', title: 'Root Task' }),
      makeTask({
        taskId: 'task-2',
        title: 'Child Task',
        parentTaskId: 'task-1',
      }),
    ]

    mockRouteTaskId = 'task-2'

    render(<TaskDetailPage />)

    fireEvent.click(screen.getByRole('tab', { name: /Cooperation/i }))

    expect(screen.getByText('Agent Group')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create Group Members/i })).not.toBeInTheDocument()
    const rootLinks = screen.getAllByText('Root Task', { selector: 'a' })
    expect(rootLinks.some((link) => link.getAttribute('to') === '/tasks/task-1')).toBe(true)
  })
})
