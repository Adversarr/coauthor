/**
 * EventTimeline — displays a chronological list of events for a task.
 *
 * Subscribes to eventBus for real-time updates with deduplication.
 */

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/utils'
import { api } from '@/services/api'
import { eventBus } from '@/stores'
import type { StoredEvent } from '@/types'

const eventColors: Record<string, string> = {
  TaskCreated:              'text-emerald-400',
  TaskStarted:              'text-violet-400',
  TaskCompleted:            'text-emerald-400',
  TaskFailed:               'text-red-400',
  TaskCanceled:             'text-zinc-500',
  TaskPaused:               'text-zinc-400',
  TaskResumed:              'text-violet-400',
  TaskInstructionAdded:     'text-sky-400',
  UserInteractionRequested: 'text-amber-400',
  UserInteractionResponded: 'text-amber-300',
}

const MAX_EVENTS = 500

export function EventTimeline({ taskId }: { taskId: string }) {
  const [events, setEvents] = useState<StoredEvent[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const seenIdsRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    seenIdsRef.current.clear()
    api.getEvents(0, taskId).then(fetched => {
      for (const e of fetched) seenIdsRef.current.add(e.id)
      setEvents(fetched.length > MAX_EVENTS ? fetched.slice(-MAX_EVENTS) : fetched)
    }).catch(err => {
      console.error('[EventTimeline] Failed to load events:', err)
    })
  }, [taskId])

  useEffect(() => {
    const unsub = eventBus.on('domain-event', (event) => {
      const payload = event.payload as Record<string, unknown>
      if (payload.taskId !== taskId) return
      if (seenIdsRef.current.has(event.id)) return
      seenIdsRef.current.add(event.id)
      setEvents(prev => {
        const next = [...prev, event]
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
      })
    })
    return unsub
  }, [taskId])

  const toggle = (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setExpanded(next)
  }

  if (events.length === 0) {
    return <p className="text-sm text-zinc-500 italic">No events yet.</p>
  }

  return (
    <div className="space-y-1">
      {events.map(evt => (
        <div key={evt.id} className="group">
          <button
            onClick={() => toggle(evt.id)}
            className="w-full flex items-center gap-3 px-2 py-1.5 rounded hover:bg-zinc-800/50 transition-colors text-left"
          >
            <span className="text-xs text-zinc-600 font-mono w-16 shrink-0">
              {formatTime(evt.createdAt)}
            </span>
            <span className={cn('text-xs font-medium', eventColors[evt.type] ?? 'text-zinc-400')}>
              {evt.type}
            </span>
            <span className="text-xs text-zinc-600">#{evt.id}</span>
          </button>

          {expanded.has(evt.id) && (
            <pre className="ml-20 text-xs text-zinc-500 bg-zinc-900 rounded p-2 mb-1 overflow-x-auto border border-zinc-800">
              {JSON.stringify(evt.payload, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
