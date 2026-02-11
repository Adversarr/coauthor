/**
 * Notifications module tests — verifies that eventBus domain events trigger toast calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StoredEvent } from '@/types'

// Mock sonner before importing the module
const mockToast = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: mockToast }))

import { eventBus } from '@/stores/eventBus'

// Import the notifications module to activate the subscription
import '@/notifications'

function makeEvent(
  type: string,
  payload: Record<string, unknown> = {},
  createdAt: string = new Date().toISOString(),
): StoredEvent {
  return {
    id: Math.random() * 1000 | 0,
    streamId: 's-1',
    seq: 1,
    type: type as StoredEvent['type'],
    payload,
    createdAt,
  }
}

describe('notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires info toast on TaskCreated', () => {
    eventBus.emit('domain-event', makeEvent('TaskCreated', { title: 'My Task' }))
    expect(mockToast.info).toHaveBeenCalledWith(expect.stringContaining('My Task'))
  })

  it('fires success toast on TaskCompleted', () => {
    eventBus.emit('domain-event', makeEvent('TaskCompleted', { title: 'Done Task' }))
    expect(mockToast.success).toHaveBeenCalled()
  })

  it('fires error toast on TaskFailed', () => {
    eventBus.emit('domain-event', makeEvent('TaskFailed', { reason: 'Something broke' }))
    expect(mockToast.error).toHaveBeenCalled()
  })

  it('fires warning toast on TaskCanceled', () => {
    eventBus.emit('domain-event', makeEvent('TaskCanceled', {}))
    expect(mockToast.warning).toHaveBeenCalled()
  })

  it('fires warning toast on UserInteractionRequested', () => {
    eventBus.emit('domain-event', makeEvent('UserInteractionRequested', { purpose: 'Confirm deletion' }))
    expect(mockToast.warning).toHaveBeenCalledWith('Action required', expect.objectContaining({ description: 'Confirm deletion' }))
  })

  it('suppresses old historical events on startup', () => {
    const oldTs = new Date(Date.now() - 60_000).toISOString()
    eventBus.emit('domain-event', makeEvent('TaskCompleted', { title: 'Old' }, oldTs))
    expect(mockToast.success).not.toHaveBeenCalled()
  })
})
