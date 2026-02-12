/**
 * Component tests for StatusBadge.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/components/display/StatusBadge'

describe('StatusBadge', () => {
  it('renders "Running" for in_progress status', () => {
    render(<StatusBadge status="in_progress" />)
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('renders "Done" for done status', () => {
    render(<StatusBadge status="done" />)
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders "Failed" for failed status', () => {
    render(<StatusBadge status="failed" />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('renders "Awaiting User" for awaiting_user status', () => {
    render(<StatusBadge status="awaiting_user" />)
    expect(screen.getByText('Awaiting User')).toBeInTheDocument()
  })

  it('renders "Open" for open status', () => {
    render(<StatusBadge status="open" />)
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('renders "Paused" for paused status', () => {
    render(<StatusBadge status="paused" />)
    expect(screen.getByText('Paused')).toBeInTheDocument()
  })

  it('renders "Canceled" for canceled status', () => {
    render(<StatusBadge status="canceled" />)
    expect(screen.getByText('Canceled')).toBeInTheDocument()
  })
})
