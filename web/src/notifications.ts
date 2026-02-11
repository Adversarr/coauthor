/**
 * Notification side-effects — fires toast notifications for important events.
 *
 * Subscribes to eventBus once at module import time.  Each domain event is
 * mapped to a toast type (success / error / info / warning) so the user
 * gets a non-intrusive visual cue for task lifecycle changes.
 *
 * Import this file in main.tsx as `import './notifications'` to activate.
 */

import { toast } from 'sonner'
import { eventBus } from './stores/eventBus'
import type { StoredEvent } from './types'

const appBootTimeMs = Date.now()
const HISTORICAL_EVENT_SKEW_MS = 2_000
const RECENT_EVENT_ID_CAP = 2_000
const seenEventIds = new Set<number>()
const seenEventQueue: number[] = []

function markEventSeen(eventId: number): boolean {
  if (seenEventIds.has(eventId)) return false
  seenEventIds.add(eventId)
  seenEventQueue.push(eventId)
  if (seenEventQueue.length > RECENT_EVENT_ID_CAP) {
    const oldest = seenEventQueue.shift()
    if (oldest != null) seenEventIds.delete(oldest)
  }
  return true
}

function shouldNotify(event: StoredEvent): boolean {
  // Skip duplicates/replays while keeping memory bounded.
  if (!markEventSeen(event.id)) return false

  // Suppress historical replay on app launch.
  const createdAtMs = Date.parse(event.createdAt)
  if (!Number.isNaN(createdAtMs) && createdAtMs < appBootTimeMs - HISTORICAL_EVENT_SKEW_MS) {
    return false
  }

  return true
}

function handleEvent(event: StoredEvent) {
  if (!shouldNotify(event)) return

  const p = event.payload as Record<string, unknown>
  const title = (p.title as string) || event.streamId

  switch (event.type) {
    case 'TaskCreated':
      toast.info(`Task created: ${title}`.slice(0, 120))
      break
    case 'TaskStarted':
      toast.info('Agent started working', { description: title })
      break
    case 'TaskCompleted':
      toast.success('Task completed', { description: title })
      break
    case 'TaskFailed':
      toast.error('Task failed', { description: (p.reason as string) || title })
      break
    case 'TaskCanceled':
      toast.warning('Task canceled', { description: title })
      break
    case 'UserInteractionRequested':
      toast.warning('Action required', { description: String(p.purpose || 'Agent needs your input') })
      break
    // TaskPaused, TaskResumed, TaskInstructionAdded — skip (too noisy)
  }
}

eventBus.on('domain-event', handleEvent)
