/**
 * Activity page — global event log with auto-refresh support.
 */

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/utils'
import { api } from '@/services/api'
import { useConnectionStore } from '@/stores'
import type { StoredEvent } from '@/types'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

const eventColors: Record<string, string> = {
  TaskCreated: 'text-emerald-400', TaskStarted: 'text-violet-400', TaskCompleted: 'text-emerald-400',
  TaskFailed: 'text-red-400', TaskCanceled: 'text-zinc-500', TaskPaused: 'text-zinc-400',
  TaskResumed: 'text-violet-400', TaskInstructionAdded: 'text-sky-400',
  UserInteractionRequested: 'text-amber-400', UserInteractionResponded: 'text-amber-300',
}

export function ActivityPage() {
  const [events, setEvents] = useState<StoredEvent[]>([])
  const [loading, setLoading] = useState(true)

  const fetchEvents = useCallback(() => {
    setLoading(true)
    api.getEvents(0).then(e => { setEvents(e); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  // Initial fetch
  useEffect(() => { fetchEvents() }, [fetchEvents])

  // Auto-refresh every 10 seconds when connected (F9)
  const status = useConnectionStore(s => s.status)
  useEffect(() => {
    if (status !== 'connected') return
    const interval = setInterval(fetchEvents, 10_000)
    return () => clearInterval(interval)
  }, [status, fetchEvents])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Activity</h1>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-zinc-500 italic">No events yet.</p>
      ) : (
        <Card className="bg-zinc-950/40">
          <CardHeader>
            <CardTitle className="text-base">Event Log</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[520px]">
              <div className="space-y-1 pr-4">
                {[...events].reverse().map(evt => (
                  <div key={evt.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-accent/40 transition-colors">
                    <span className="text-xs text-zinc-600 font-mono w-16 shrink-0">{formatTime(evt.createdAt)}</span>
                    <span className={cn('text-xs font-medium w-48 shrink-0', eventColors[evt.type] ?? 'text-zinc-400')}>{evt.type}</span>
                    <Link
                      to={`/tasks/${evt.streamId}`}
                      className="text-xs text-zinc-500 hover:text-primary transition-colors font-mono truncate"
                    >
                      {evt.streamId}
                    </Link>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
