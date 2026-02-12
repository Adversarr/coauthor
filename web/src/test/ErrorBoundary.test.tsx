/**
 * Tests for the ErrorBoundary component.
 *
 * Validates that:
 * - Children render normally when no error
 * - Crash UI appears when a child throws
 * - Custom fallback prop is respected
 * - "Try Again" resets error state and re-renders children
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '@/components/display/ErrorBoundary'

// Suppress console.error noise from React and ErrorBoundary during intentional throws
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function ThrowingChild({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('Test crash')
  return <div>Working child</div>
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  it('shows crash UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Test crash')).toBeInTheDocument()
  })

  it('shows Try Again and Reload Page buttons', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Try Again')).toBeInTheDocument()
    expect(screen.getByText('Reload Page')).toBeInTheDocument()
  })

  it('uses custom fallback prop when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom Fallback</div>}>
        <ThrowingChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Custom Fallback')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('resets error state when Try Again is clicked', () => {
    // Use a stateful approach: first render throws, after reset it should try again
    let shouldThrow = true
    function ConditionalChild() {
      if (shouldThrow) throw new Error('First render crash')
      return <div>Recovered</div>
    }

    render(
      <ErrorBoundary>
        <ConditionalChild />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Stop throwing before clicking Try Again
    shouldThrow = false
    fireEvent.click(screen.getByText('Try Again'))

    expect(screen.getByText('Recovered')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('logs error to console', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    )
    expect(console.error).toHaveBeenCalled()
  })
})
