/**
 * TaskDetailPage — detailed view of a single task with live output, events, and interactions.
 */

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Pause, Play, X, MessageSquare, Bot, Clock } from 'lucide-react'
import { formatTime, timeAgo } from '@/lib/utils'
import { useTaskStore } from '@/stores'
import { api } from '@/services/api'
import { StatusBadge } from '@/components/StatusBadge'
import { PriorityIcon } from '@/components/PriorityIcon'
import { StreamOutput } from '@/components/StreamOutput'
import { EventTimeline } from '@/components/EventTimeline'
import { InteractionPanel } from '@/components/InteractionPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { PendingInteraction } from '@/types'

export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const task = useTaskStore(s => s.tasks.find(t => t.taskId === taskId))
  const fetchTask = useTaskStore(s => s.fetchTask)
  const [instruction, setInstruction] = useState('')
  const [sending, setSending] = useState(false)
  const [interaction, setInteraction] = useState<PendingInteraction | null>(null)
  const [tab, setTab] = useState<'output' | 'events'>('output')
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
    lastFetchIdRef.current = taskId
    fetchInFlightRef.current = true
    setTaskLoading(true)
    fetchTask(taskId)
      .then(t => {
        setTaskLoading(false)
        if (!t) setTaskNotFound(true)
      })
      .finally(() => {
        fetchInFlightRef.current = false
      })
  }, [taskId, task, fetchTask])

  useEffect(() => {
    let cancelled = false
    if (taskId && task?.pendingInteractionId) {
      api.getPendingInteraction(taskId).then(p => {
        if (!cancelled) setInteraction(p)
      }).catch(() => {})
    } else {
      if (interaction) setInteraction(null)
    }
    return () => {
      cancelled = true
    }
  }, [taskId, task?.pendingInteractionId])

  if (taskLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <p className="text-sm">Loading task…</p>
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

  const handleInstruction = async () => {
    if (!instruction.trim() || !taskId) return
    setSending(true)
    try {
      await api.addInstruction(taskId, instruction.trim())
      setInstruction('')
    } catch {
      // ignore
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/')}
          className="mt-1"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
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
            <span className="font-mono text-zinc-700">{task.taskId}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {canPause && (
          <Button
            variant="secondary"
            onClick={() => api.pauseTask(task.taskId)}
          >
            <Pause className="h-4 w-4" /> Pause
          </Button>
        )}
        {canResume && (
          <Button
            onClick={() => api.resumeTask(task.taskId)}
          >
            <Play className="h-4 w-4" /> Resume
          </Button>
        )}
        {canCancel && (
          <Button
            variant="destructive"
            onClick={() => api.cancelTask(task.taskId)}
          >
            <X className="h-4 w-4" /> Cancel
          </Button>
        )}
      </div>

      {/* Terminal Summary */}
      {task.summary && (
        <Alert className="border-emerald-800/40 bg-emerald-950/20 text-emerald-200">
          <AlertTitle>Summary</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">{task.summary}</p>
          </AlertDescription>
        </Alert>
      )}
      {task.failureReason && (
        <Alert variant="destructive" className="bg-red-950/20">
          <AlertTitle>Failure</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">{task.failureReason}</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Interaction */}
      {interaction && <InteractionPanel interaction={interaction} />}

      {/* Instruction input */}
      {isActive && (
        <div className="flex gap-2">
          <Input
            type="text"
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder="Add instruction for the agent…"
            className="flex-1"
            onKeyDown={e => e.key === 'Enter' && handleInstruction()}
          />
          <Button
            onClick={handleInstruction}
            disabled={sending || !instruction.trim()}
          >
            <MessageSquare className="h-4 w-4" /> Send
          </Button>
        </div>
      )}

      {/* Tabs: Output / Events */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="bg-zinc-900">
          <TabsTrigger value="output" className="capitalize">output</TabsTrigger>
          <TabsTrigger value="events" className="capitalize">events</TabsTrigger>
        </TabsList>
        <TabsContent value="output">
          <StreamOutput taskId={task.taskId} />
        </TabsContent>
        <TabsContent value="events">
          <EventTimeline taskId={task.taskId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
