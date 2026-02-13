/**
 * Tests for EventTimeline component — real-time updates with deduplication.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EventTimeline } from '@/components/panels/EventTimeline'
import { eventBus } from '@/stores/eventBus'
import * as api from '@/services/api'
import type { StoredEvent } from '@/types'

vi.mock('@/services/api', () => ({
  api: {
    getEvents: vi.fn(),
  },
}))

function makeEvent(id: number, type: string, taskId: string, payload: Record<string, unknown> = {}): StoredEvent {
  return {
    id,
    streamId: taskId,
    seq: id,
    type: type as StoredEvent['type'],
    payload: { taskId, ...payload },
    createdAt: new Date().toISOString(),
  } as StoredEvent
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      {ui}
    </MemoryRouter>
  )
}

describe('EventTimeline', () => {
  beforeEach(() => {
    eventBus.clear()
    vi.clearAllMocks()
  })

  it('fetches events on mount', async () => {
    const mockEvents = [
      makeEvent(1, 'TaskCreated', 'task-1', { title: 'Test Task' }),
      makeEvent(2, 'TaskStarted', 'task-1'),
    ]
    vi.mocked(api.api.getEvents).mockResolvedValue(mockEvents)

    renderWithRouter(<EventTimeline taskId="task-1" />)

    await waitFor(() => {
      expect(api.api.getEvents).toHaveBeenCalledWith(0, 'task-1')
    })
  })

  it('displays fetched events', async () => {
    const mockEvents = [
      makeEvent(1, 'TaskCreated', 'task-1', { title: 'Test Task' }),
    ]
    vi.mocked(api.api.getEvents).mockResolvedValue(mockEvents)

    renderWithRouter(<EventTimeline taskId="task-1" />)

    await waitFor(() => {
      expect(screen.getByText('TaskCreated')).toBeInTheDocument()
    })
  })

  it('shows real-time events via eventBus', async () => {
    vi.mocked(api.api.getEvents).mockResolvedValue([])

    renderWithRouter(<EventTimeline taskId="task-1" />)

    await waitFor(() => {
      expect(api.api.getEvents).toHaveBeenCalled()
    })

    const newEvent = makeEvent(100, 'TaskStarted', 'task-1')
    act(() => {
      eventBus.emit('domain-event', newEvent)
    })

    await waitFor(() => {
      expect(screen.getByText('TaskStarted')).toBeInTheDocument()
    })
  })

  it('deduplicates events by ID', async () => {
    const existingEvent = makeEvent(1, 'TaskCreated', 'task-1', { title: 'Test' })
    vi.mocked(api.api.getEvents).mockResolvedValue([existingEvent])

    renderWithRouter(<EventTimeline taskId="task-1" />)

    await waitFor(() => {
      expect(screen.getByText('TaskCreated')).toBeInTheDocument()
    })

    eventBus.emit('domain-event', existingEvent)
    eventBus.emit('domain-event', existingEvent)

    await waitFor(() => {
      const elements = screen.getAllByText('TaskCreated')
      expect(elements).toHaveLength(1)
    })
  })

  it('ignores events for different taskId', async () => {
    vi.mocked(api.api.getEvents).mockResolvedValue([])

    renderWithRouter(<EventTimeline taskId="task-1" />)

    await waitFor(() => {
      expect(api.api.getEvents).toHaveBeenCalled()
    })

    const otherEvent = makeEvent(100, 'TaskCreated', 'task-2', { title: 'Other' })
    eventBus.emit('domain-event', otherEvent)

    await waitFor(() => {
      expect(screen.queryByText('TaskCreated')).not.toBeInTheDocument()
    })
  })

  it('caps events at MAX_EVENTS (500)', async () => {
    const manyEvents: StoredEvent[] = []
    for (let i = 1; i <= 600; i++) {
      manyEvents.push(makeEvent(i, 'TaskInstructionAdded', 'task-1', { instruction: `inst-${i}` }))
    }
    vi.mocked(api.api.getEvents).mockResolvedValue(manyEvents)

    renderWithRouter(<EventTimeline taskId="task-1" />)

    await waitFor(() => {
      const elements = screen.getAllByText('TaskInstructionAdded')
      expect(elements.length).toBeLessThanOrEqual(500)
    })
  })

  it('shows empty state when no events', async () => {
    vi.mocked(api.api.getEvents).mockResolvedValue([])

    renderWithRouter(<EventTimeline taskId="task-1" />)

    await waitFor(() => {
      expect(screen.getByText('No events yet.')).toBeInTheDocument()
    })
  })

  it('toggles payload visibility with accessible expanded state', async () => {
    vi.mocked(api.api.getEvents).mockResolvedValue([
      makeEvent(1, 'TaskCreated', 'task-1', { title: 'Test Task' }),
    ])

    renderWithRouter(<EventTimeline taskId="task-1" />)

    const rowButton = await screen.findByRole('button', { name: /TaskCreated/ })
    expect(rowButton).toHaveAttribute('aria-expanded', 'false')
    expect(rowButton).toHaveAttribute('aria-controls', 'event-payload-1')

    fireEvent.click(rowButton)

    expect(rowButton).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText(/"title": "Test Task"/)).toBeInTheDocument()
  })
})
