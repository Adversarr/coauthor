/**
 * Tests for SettingsPage — race condition prevention with isReconnecting state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SettingsPage } from '@/pages/SettingsPage'

const mockConnect = vi.fn()
const mockDisconnect = vi.fn()

vi.mock('@/stores', () => ({
  useConnectionStore: vi.fn((selector) => {
    const state = { status: 'connected', connect: mockConnect, disconnect: mockDisconnect }
    return selector(state)
  }),
  useRuntimeStore: vi.fn((selector) => {
    const state = { agents: [], fetchRuntime: vi.fn(), defaultAgentId: null }
    return selector(state)
  }),
}))

describe('SettingsPage — race condition prevention (Task 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders settings page', () => {
    render(<SettingsPage />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('uses a scrollable page container so lower settings remain reachable', () => {
    const { container } = render(<SettingsPage />)
    const root = container.firstElementChild
    expect(root).toHaveClass('overflow-y-auto')
    expect(root).toHaveClass('h-full')
  })

  it('shows connection status', () => {
    render(<SettingsPage />)
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('disables button during reconnect', async () => {
    render(<SettingsPage />)

    const button = screen.getByRole('button', { name: 'Save & Reconnect' })
    expect(button).not.toBeDisabled()

    act(() => {
      fireEvent.click(button)
    })

    expect(button).toBeDisabled()
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
  })

  it('prevents rapid clicks from triggering multiple reconnects', async () => {
    render(<SettingsPage />)

    const button = screen.getByRole('button', { name: 'Save & Reconnect' })

    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)
    })

    expect(mockDisconnect).toHaveBeenCalledTimes(1)
  })

  it('calls disconnect then connect after delay', async () => {
    render(<SettingsPage />)

    const button = screen.getByRole('button', { name: 'Save & Reconnect' })
    act(() => {
      fireEvent.click(button)
    })

    expect(mockDisconnect).toHaveBeenCalledTimes(1)
    expect(mockConnect).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('re-enables button after reconnect completes', async () => {
    render(<SettingsPage />)

    const button = screen.getByRole('button', { name: 'Save & Reconnect' })
    fireEvent.click(button)

    expect(button).toBeDisabled()

    // Advance to trigger reconnect
    act(() => {
      vi.advanceTimersByTime(200)
    })
    // Advance to clear saved status
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    // In fake timers mode, we should check state immediately after advancing
    expect(button).not.toBeDisabled()
    expect(screen.getByText('Save & Reconnect')).toBeInTheDocument()
  })

  it('saves token to sessionStorage', async () => {
    render(<SettingsPage />)

    const input = screen.getByPlaceholderText('Paste your auth token…')
    act(() => {
      fireEvent.change(input, { target: { value: 'test-token-123' } })
    })

    const button = screen.getByRole('button', { name: 'Save & Reconnect' })
    act(() => {
      fireEvent.click(button)
    })

    expect(sessionStorage.getItem('seed-token')).toBe('test-token-123')
  })

  it('shows saved status after reconnect', async () => {
    render(<SettingsPage />)

    const button = screen.getByRole('button', { name: 'Save & Reconnect' })
    act(() => {
      fireEvent.click(button)
    })

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByText('Token saved. Reconnecting…')).toBeInTheDocument()
  })
})
