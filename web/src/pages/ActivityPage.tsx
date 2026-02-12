/**
 * Activity page — global event log and audit timeline with real-time updates.
 *
 * Two sections:
 * 1. Event Log — all domain events (TaskCreated, TaskStarted, etc.)
 * 2. Audit Log — audit entries from the audit service
 *
 * Deduplicates events from initial fetch and real-time subscription.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/utils'
import { api } from '@/services/api'
import { useConnectionStore, eventBus } from '@/stores'
import type { StoredEvent } from '@/types'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Activity, FileText, Zap } from 'lucide-react'

const eventColors: Record<string, string> = {
  TaskCreated: 'text-emerald-400', TaskStarted: 'text-violet-400', TaskCompleted: 'text-emerald-400',
  TaskFailed: 'text-red-400', TaskCanceled: 'text-zinc-500', TaskPaused: 'text-zinc-400',
  TaskResumed: 'text-violet-400', TaskInstructionAdded: 'text-sky-400',
  UserInteractionRequested: 'text-amber-400', UserInteractionResponded: 'text-amber-300',
}

const eventIcons: Record<string, string> = {
  TaskCreated: '✦', TaskStarted: '▶', TaskCompleted: '✓', TaskFailed: '✕',
  TaskCanceled: '⦸', TaskPaused: '‖', TaskResumed: '▶',
  TaskInstructionAdded: '✎', UserInteractionRequested: '?', UserInteractionResponded: '↩',
}

const MAX_ACTIVITY_EVENTS = 2000

export function ActivityPage() {
  const [events, setEvents] = useState<StoredEvent[]>([])
  const [auditEntries, setAuditEntries] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'events' | 'audit'>('events')
  const seenIdsRef = useRef<Set<number>>(new Set())

  const fetchEvents = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    seenIdsRef.current.clear()
    api.getEvents(0)
      .then(fetched => {
        if (signal?.aborted) return
        for (const e of fetched) seenIdsRef.current.add(e.id)
        setEvents(fetched.length > MAX_ACTIVITY_EVENTS ? fetched.slice(-MAX_ACTIVITY_EVENTS) : fetched)
        setLoading(false)
      })
      .catch(err => {
        if ((err as Error).name === 'AbortError' || signal?.aborted) return
        console.error('[ActivityPage] Failed to fetch events:', err)
        setLoading(false)
      })
  }, [])

  const fetchAudit = useCallback((signal?: AbortSignal) => {
    api.getAudit(100, undefined, { signal })
      .then(entries => {
        setAuditEntries(entries as Record<string, unknown>[])
      })
      .catch(err => {
        if ((err as Error).name === 'AbortError') return
        console.error('[ActivityPage] Failed to fetch audit entries:', err)
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchEvents(controller.signal)
    fetchAudit(controller.signal)
    return () => controller.abort()
  }, [fetchEvents, fetchAudit])

  useEffect(() => {
    const unsub = eventBus.on('domain-event', (event) => {
      if (seenIdsRef.current.has(event.id)) return
      seenIdsRef.current.add(event.id)
      setEvents(prev => {
        const next = [...prev, event]
        return next.length > MAX_ACTIVITY_EVENTS ? next.slice(-MAX_ACTIVITY_EVENTS) : next
      })
    })
    return unsub
  }, [])

  // Auto-refresh audit every 15 seconds
  const status = useConnectionStore(s => s.status)
  useEffect(() => {
    if (status !== 'connected') return
    const interval = setInterval(fetchAudit, 15_000)
    return () => clearInterval(interval)
  }, [status, fetchAudit])

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 space-y-6 pb-4">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-violet-400" />
          <h1 className="text-2xl font-bold text-zinc-100">Activity</h1>
        </div>

      </div>
      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)} className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-zinc-900 shrink-0">
          <TabsTrigger value="events" className="gap-1.5">
            <Zap className="h-3.5 w-3.5" /> Events
            <span className="ml-1 text-[10px] text-zinc-500">{events.length}</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Audit
            <span className="ml-1 text-[10px] text-zinc-500">{auditEntries.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="flex-1 min-h-0 overflow-hidden mt-0 pt-2">
          {loading ? (
            <p className="text-sm text-zinc-500 py-8 text-center">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-zinc-500 italic py-8 text-center">No events yet.</p>
          ) : (
            <Card className="bg-zinc-950/40 h-full">
              <CardContent className="p-0 h-full">
                <ScrollArea className="h-full">
                  <div className="divide-y divide-zinc-800/50">
                    {[...events].reverse().map(evt => {
                      const payload = evt.payload as Record<string, unknown>
                      return (
                        <div key={evt.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/20 transition-colors">
                          <span className="text-sm w-5 text-center shrink-0" title={evt.type}>
                            {eventIcons[evt.type] ?? '·'}
                          </span>
                          <span className="text-xs text-zinc-600 font-mono w-16 shrink-0">{formatTime(evt.createdAt)}</span>
                          <span className={cn('text-xs font-medium w-44 shrink-0 truncate', eventColors[evt.type] ?? 'text-zinc-400')}>
                            {evt.type}
                          </span>
                          <Link
                            to={`/tasks/${evt.streamId}`}
                            className="text-xs text-zinc-500 hover:text-primary transition-colors font-mono truncate flex-1"
                          >
                            {(payload.title as string) || evt.streamId}
                          </Link>
                          <span className="text-[10px] text-zinc-700 shrink-0">#{evt.id}</span>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="audit" className="flex-1 min-h-0 overflow-hidden mt-0 pt-2">
          {auditEntries.length === 0 ? (
            <p className="text-sm text-zinc-500 italic py-8 text-center">No audit entries.</p>
          ) : (
            <Card className="bg-zinc-950/40 h-full">
              <CardContent className="p-0 h-full">
                <ScrollArea className="h-full">
                  <div className="divide-y divide-zinc-800/50">
                    {[...auditEntries].reverse().map((entry, i) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-accent/20 transition-colors">
                        <span className="text-xs text-zinc-600 font-mono w-16 shrink-0 mt-0.5">
                          {entry.timestamp ? formatTime(String(entry.timestamp)) : '—'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-zinc-300">{String(entry.action ?? entry.type ?? 'audit')}</p>
                          {typeof entry.taskId === 'string' && (
                            <Link
                              to={`/tasks/${entry.taskId}`}
                              className="text-[10px] text-zinc-500 hover:text-primary font-mono"
                            >
                              {String(entry.taskId)}
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
