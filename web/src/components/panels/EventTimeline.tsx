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
import { Button } from '@/components/ui/button'
import type { StoredEvent } from '@/types'

const eventColors: Record<string, string> = {
  TaskCreated:              'text-emerald-400',
  TaskStarted:              'text-primary',
  TaskCompleted:            'text-emerald-400',
  TaskFailed:               'text-destructive',
  TaskCanceled:             'text-muted-foreground',
  TaskPaused:               'text-muted-foreground',
  TaskResumed:              'text-primary',
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
    return <p className="text-sm text-muted-foreground italic">No events yet.</p>
  }

  return (
    <div className="space-y-1">
      {events.map((evt) => {
        const payloadId = `event-payload-${evt.id}`
        const isExpanded = expanded.has(evt.id)

        return (
          <div key={evt.id} className="group">
            <Button
              type="button"
              variant="ghost"
              onClick={() => toggle(evt.id)}
              aria-expanded={isExpanded}
              aria-controls={payloadId}
              className="h-auto w-full justify-start gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
            >
              <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                {formatTime(evt.createdAt)}
              </span>
              <span className={cn('text-xs font-medium', eventColors[evt.type] ?? 'text-muted-foreground')}>
                {evt.type}
              </span>
              <span className="text-xs text-muted-foreground">#{evt.id}</span>
            </Button>

            {isExpanded && (
              <pre
                id={payloadId}
                className="mb-1 ml-20 overflow-x-auto rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground"
              >
                {JSON.stringify(evt.payload, null, 2)}
              </pre>
            )}
          </div>
        )
      })}
    </div>
  )
}
