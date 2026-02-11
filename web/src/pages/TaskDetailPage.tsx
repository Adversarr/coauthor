/**
 * TaskDetailPage — detailed view of a single task with live output, events, and interactions.
 */

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Pause, Play, X, MessageSquare, Bot, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTime, timeAgo } from '@/lib/utils'
import { useTaskStore } from '@/stores'
import { api } from '@/services/api'
import { StatusBadge } from '@/components/StatusBadge'
import { PriorityIcon } from '@/components/PriorityIcon'
import { StreamOutput } from '@/components/StreamOutput'
import { EventTimeline } from '@/components/EventTimeline'
import { InteractionPanel } from '@/components/InteractionPanel'
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
        <button
          onClick={() => navigate('/')}
          className="mt-1 p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
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
          <button
            onClick={() => api.pauseTask(task.taskId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
          >
            <Pause size={14} /> Pause
          </button>
        )}
        {canResume && (
          <button
            onClick={() => api.resumeTask(task.taskId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-700 hover:bg-violet-600 text-white text-sm transition-colors"
          >
            <Play size={14} /> Resume
          </button>
        )}
        {canCancel && (
          <button
            onClick={() => api.cancelTask(task.taskId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-red-900/40 text-zinc-400 hover:text-red-300 text-sm transition-colors"
          >
            <X size={14} /> Cancel
          </button>
        )}
      </div>

      {/* Terminal Summary */}
      {task.summary && (
        <div className="rounded-lg bg-emerald-950/20 border border-emerald-800/30 p-4">
          <p className="text-sm font-medium text-emerald-300 mb-1">Summary</p>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">{task.summary}</p>
        </div>
      )}
      {task.failureReason && (
        <div className="rounded-lg bg-red-950/20 border border-red-800/30 p-4">
          <p className="text-sm font-medium text-red-300 mb-1">Failure</p>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">{task.failureReason}</p>
        </div>
      )}

      {/* Interaction */}
      {interaction && <InteractionPanel interaction={interaction} />}

      {/* Instruction input */}
      {isActive && (
        <div className="flex gap-2">
          <input
            type="text"
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder="Add instruction for the agent…"
            className="flex-1 rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            onKeyDown={e => e.key === 'Enter' && handleInstruction()}
          />
          <button
            onClick={handleInstruction}
            disabled={sending || !instruction.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <MessageSquare size={14} /> Send
          </button>
        </div>
      )}

      {/* Tabs: Output / Events */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
        {(['output', 'events'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize',
              tab === t ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'output' && <StreamOutput taskId={task.taskId} />}
      {tab === 'events' && <EventTimeline taskId={task.taskId} />}
    </div>
  )
}
