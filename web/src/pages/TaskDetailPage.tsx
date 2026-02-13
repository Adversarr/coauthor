/**
 * TaskDetailPage — detailed view of a single task with conversation, output, events, and summary.
 *
 * Four-tab layout:
 * 1. Conversation — rich chat interface (ai-elements) with live streaming (default)
 * 2. Output — raw streaming terminal output (power users)
 * 3. Events — raw event timeline (debugging)
 * 4. Summary — final task summary (when available)
 */

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Pause, Play, X, Bot, Clock, MessageSquare, Terminal, List, GitBranch, FileText } from 'lucide-react'
import { formatTime, timeAgo } from '@/lib/utils'
import { useTaskStore } from '@/stores'
import { api } from '@/services/api'
import { StatusBadge } from '@/components/display/StatusBadge'
import { PriorityIcon } from '@/components/display/PriorityIcon'
import { StreamOutput } from '@/components/panels/StreamOutput'
import { EventTimeline } from '@/components/panels/EventTimeline'
import { InteractionPanel } from '@/components/panels/InteractionPanel'
import { ConversationView } from '@/components/panels/ConversationView'
import { PromptBar } from '@/components/panels/PromptBar'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { PendingInteraction } from '@/types'

export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const task = useTaskStore(s => s.tasks.find(t => t.taskId === taskId))
  const allTasks = useTaskStore(s => s.tasks) // Must be above early returns (Rules of Hooks)
  const fetchTask = useTaskStore(s => s.fetchTask)
  const [interaction, setInteraction] = useState<PendingInteraction | null>(null)
  const [tab, setTab] = useState<'conversation' | 'output' | 'events' | 'summary'>('conversation')
  const [taskLoading, setTaskLoading] = useState(false)
  const [taskNotFound, setTaskNotFound] = useState(false)
  const lastFetchIdRef = useRef<string | null>(null)
  const fetchInFlightRef = useRef(false)

  // Fetch task from API if not in store (supports direct navigation / page refresh)
  useEffect(() => {
    if (!taskId) return
    if (task) {
      if (taskNotFound) setTaskNotFound(false)
      if (taskLoading) setTaskLoading(false)
      return
    }
    if (lastFetchIdRef.current === taskId && fetchInFlightRef.current) return

    const controller = new AbortController()
    lastFetchIdRef.current = taskId
    fetchInFlightRef.current = true
    setTaskLoading(true)
    fetchTask(taskId, { signal: controller.signal })
      .then(t => {
        if (controller.signal.aborted) return
        setTaskLoading(false)
        if (!t) setTaskNotFound(true)
      })
      .catch(err => {
        if (controller.signal.aborted) return
        console.error('[TaskDetailPage] Failed to fetch task:', err)
        setTaskLoading(false)
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          fetchInFlightRef.current = false
        }
      })

    return () => controller.abort()
  }, [taskId, task, fetchTask])

  // Fetch pending interaction (B4: cancel on unmount)
  useEffect(() => {
    if (!taskId || !task?.pendingInteractionId) {
      if (interaction) setInteraction(null)
      return
    }

    const controller = new AbortController()
    api.getPendingInteraction(taskId, { signal: controller.signal })
      .then(p => {
        if (!controller.signal.aborted) setInteraction(p)
      })
      .catch(err => {
        if (!controller.signal.aborted) console.error('[TaskDetailPage] Failed to fetch interaction:', err)
      })

    return () => controller.abort()
  }, [taskId, task?.pendingInteractionId, interaction])

  if (taskLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <div className="h-6 w-6 border-2 border-zinc-700 border-t-violet-500 rounded-full animate-spin" />
        <p className="text-sm mt-3">Loading task…</p>
      </div>
    )
  }

  if (!task || taskNotFound) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <p className="text-lg">Task not found</p>
        <Link to="/" className="text-sm text-violet-400 hover:text-violet-300 mt-2">
          ← Back to tasks
        </Link>
      </div>
    )
  }

  const isActive = ['open', 'in_progress', 'awaiting_user'].includes(task.status)
  const canPause = task.status === 'in_progress'
  const canResume = task.status === 'paused'
  const canCancel = isActive || task.status === 'paused'

  // Resolve child tasks from the store
  const childTasks = allTasks.filter(t => t.parentTaskId === task.taskId)

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="shrink-0 space-y-4 pb-4 border-b border-border">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="mt-1" aria-label="Back to task list">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-zinc-100 truncate">{task.title}</h1>
              <StatusBadge status={task.status} />
              <PriorityIcon priority={task.priority} showLabel />
            </div>
            {task.intent && (
              <p className="text-sm text-zinc-400 mt-1">{task.intent}</p>
            )}
            <div className="flex items-center gap-4 mt-2 text-xs text-zinc-600">
              <span className="inline-flex items-center gap-1"><Bot size={12} /> {task.agentId}</span>
              <span className="inline-flex items-center gap-1"><Clock size={12} /> {formatTime(task.createdAt)}</span>
              <span>Updated {timeAgo(task.updatedAt)}</span>
              {task.parentTaskId && (
                <Link to={`/tasks/${task.parentTaskId}`} className="text-violet-400 hover:text-violet-300">
                  ↑ parent
                </Link>
              )}
              {task.childTaskIds && task.childTaskIds.length > 0 && (
                <span className="inline-flex items-center gap-1 text-zinc-500">
                  <GitBranch size={12} /> {task.childTaskIds.length} subtask{task.childTaskIds.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 shrink-0">
            {canPause && (
              <Button variant="secondary" size="sm" onClick={() => api.pauseTask(task.taskId)}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            )}
            {canResume && (
              <Button size="sm" onClick={() => api.resumeTask(task.taskId)}>
                <Play className="h-3.5 w-3.5" /> Resume
              </Button>
            )}
            {canCancel && (
              <Button variant="destructive" size="sm" onClick={() => api.cancelTask(task.taskId)}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
            )}
          </div>
        </div>

        {/* Failure alert */}
        {task.failureReason && (
          <Alert variant="destructive" className="bg-red-950/20">
            <AlertTitle>Failure</AlertTitle>
            <AlertDescription><p className="whitespace-pre-wrap">{task.failureReason}</p></AlertDescription>
          </Alert>
        )}
      </div>

      {/* ── Child tasks ── */}
      {childTasks.length > 0 && (
        <div className="shrink-0 py-2">
          <p className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1"><GitBranch size={12} /> Subtasks</p>
          <div className="space-y-1">
            {childTasks.map(ct => (
              <Link
                key={ct.taskId}
                to={`/tasks/${ct.taskId}`}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-900/40 hover:bg-accent/40 transition-colors"
              >
                <StatusBadge status={ct.status} />
                <span className="text-sm text-zinc-300 truncate flex-1">{ct.title}</span>
                <span className="text-[10px] text-zinc-600">{timeAgo(ct.updatedAt)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Interaction banner ── */}
      {interaction && (
        <div className="shrink-0 py-3">
          <InteractionPanel interaction={interaction} />
        </div>
      )}

      {/* ── Tabs ── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex flex-col flex-1 min-h-0">
        <TabsList className="shrink-0 bg-zinc-900">
          <TabsTrigger value="conversation" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" /> Conversation
          </TabsTrigger>
          <TabsTrigger value="output" className="gap-1.5">
            <Terminal className="h-3.5 w-3.5" /> Output
          </TabsTrigger>
          <TabsTrigger value="events" className="gap-1.5">
            <List className="h-3.5 w-3.5" /> Events
          </TabsTrigger>
          <TabsTrigger value="summary" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Summary
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversation" className="flex-1 min-h-0 overflow-hidden mt-0 pt-2">
          <div className="flex h-full min-h-0 flex-col">
            <ConversationView taskId={task.taskId} className="flex-1 min-h-0" />
            <div className="shrink-0 pt-3">
              <PromptBar taskId={task.taskId} disabled={!isActive} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="output" className="flex-1 min-h-0 overflow-hidden mt-0 pt-2">
          <div className="h-full overflow-auto">
            <StreamOutput taskId={task.taskId} />
          </div>
        </TabsContent>

        <TabsContent value="events" className="flex-1 min-h-0 overflow-hidden mt-0 pt-2">
          <div className="h-full overflow-auto">
            <EventTimeline taskId={task.taskId} />
          </div>
        </TabsContent>

        <TabsContent value="summary" className="flex-1 min-h-0 overflow-hidden mt-0 pt-2">
          <div className="h-full overflow-auto">
            {task.summary ? (
              <Alert className="border-emerald-800/40 bg-emerald-950/20 text-emerald-200">
                <AlertTitle>Summary</AlertTitle>
                <AlertDescription><p className="whitespace-pre-wrap">{task.summary}</p></AlertDescription>
              </Alert>
            ) : (
              <p className="text-sm text-zinc-500 italic py-8 text-center">No summary available yet.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
