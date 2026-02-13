/**
 * Component tests for InteractionPanel.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import * as api from '@/services/api'
import { InteractionPanel } from '@/components/panels/InteractionPanel'
import type { PendingInteraction } from '@/types'

vi.mock('@/services/api', () => ({
  api: {
    respondToInteraction: vi.fn(),
  },
}))

function makeInteraction(overrides: Partial<PendingInteraction>): PendingInteraction {
  return {
    interactionId: 'interaction-1',
    taskId: 'task-1',
    kind: 'Select',
    purpose: 'confirm',
    display: {
      title: 'Confirm action',
    },
    options: [
      { id: 'accept', label: 'Accept', style: 'primary' },
      { id: 'reject', label: 'Reject', style: 'danger' },
    ],
    ...overrides,
  }
}

describe('InteractionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.api.respondToInteraction).mockResolvedValue(undefined)
  })

  it('submits selected option when option button is clicked', async () => {
    render(<InteractionPanel interaction={makeInteraction({})} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select option: Accept' }))

    await waitFor(() => {
      expect(api.api.respondToInteraction).toHaveBeenCalledWith(
        'task-1',
        'interaction-1',
        { selectedOptionId: 'accept', inputValue: undefined },
      )
    })
  })

  it('submits input response from send button', async () => {
    render(
      <InteractionPanel
        interaction={makeInteraction({
          kind: 'Input',
          options: [],
        })}
      />,
    )

    const input = screen.getByPlaceholderText('Type your response…')
    fireEvent.change(input, { target: { value: 'ship it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send response' }))

    await waitFor(() => {
      expect(api.api.respondToInteraction).toHaveBeenCalledWith(
        'task-1',
        'interaction-1',
        { selectedOptionId: undefined, inputValue: 'ship it' },
      )
    })
  })

  it('submits input response when Enter is pressed', async () => {
    render(
      <InteractionPanel
        interaction={makeInteraction({
          kind: 'Input',
          options: [],
        })}
      />,
    )

    const input = screen.getByPlaceholderText('Type your response…')
    fireEvent.change(input, { target: { value: 'enter key response' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(api.api.respondToInteraction).toHaveBeenCalledWith(
        'task-1',
        'interaction-1',
        { selectedOptionId: undefined, inputValue: 'enter key response' },
      )
    })
  })
})
