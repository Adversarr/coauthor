/**
 * Component tests for AgentSelector layout and selected-value rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentSelector } from '@/components/navigation/AgentSelector'

const mockFetchRuntime = vi.fn()

const runtimeState = {
  agents: [
    {
      id: 'default',
      displayName: 'Default Agent',
      description:
        'General-purpose agent with a long description that should never stretch dialog layouts',
    },
  ],
  defaultAgentId: 'default' as string | null,
  loading: false,
  fetchRuntime: mockFetchRuntime,
}

vi.mock('@/stores/runtimeStore', () => ({
  useRuntimeStore: vi.fn((selector: (state: typeof runtimeState) => unknown) => selector(runtimeState)),
}))

describe('AgentSelector', () => {
  beforeEach(() => {
    mockFetchRuntime.mockClear()
    runtimeState.agents = [
      {
        id: 'default',
        displayName: 'Default Agent',
        description:
          'General-purpose agent with a long description that should never stretch dialog layouts',
      },
    ]
    runtimeState.defaultAgentId = 'default'
    runtimeState.loading = false
  })

  it('returns nothing while agents are unavailable', () => {
    runtimeState.agents = []
    const { container } = render(<AgentSelector onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an overflow-safe trigger width contract', () => {
    render(<AgentSelector onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveClass('min-w-0')
    expect(trigger).toHaveClass('max-w-full')
  })

  it('shows only the selected agent label in the closed trigger', () => {
    render(<AgentSelector onChange={vi.fn()} />)
    expect(screen.getByText('Default Agent')).toBeInTheDocument()
    expect(
      screen.queryByText(/General-purpose agent with a long description/i)
    ).not.toBeInTheDocument()
  })
})

