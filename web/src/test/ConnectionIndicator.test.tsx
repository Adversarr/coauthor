/**
 * Component tests for ConnectionIndicator.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConnectionIndicator } from '@/components/display/ConnectionIndicator'
import { useConnectionStore } from '@/stores/connectionStore'

describe('ConnectionIndicator', () => {
  beforeEach(() => {
    useConnectionStore.setState({ status: 'disconnected' })
  })

  it('shows connected status', () => {
    useConnectionStore.setState({ status: 'connected' })
    render(<ConnectionIndicator />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('shows connecting status', () => {
    useConnectionStore.setState({ status: 'connecting' })
    render(<ConnectionIndicator />)
    expect(screen.getByText('Connecting')).toBeInTheDocument()
  })

  it('shows disconnected status', () => {
    useConnectionStore.setState({ status: 'disconnected' })
    render(<ConnectionIndicator />)
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })
})
