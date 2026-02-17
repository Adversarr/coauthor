/**
 * TaskDetailPage — detailed view of a single task with conversation, output, events, and summary.
 *
 * Four-tab layout:
 * 1. Conversation — replayed persisted conversation history
 * 2. Output — replay transcript derived from persisted conversation
 * 3. Events — raw event timeline (debugging)
 * 4. Summary — final task summary (when available)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { TaskTodoQueue } from '@/components/panels/TaskTodoQueue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CreateTaskGroupDialog } from '@/components/dialogs/CreateTaskGroupDialog'
import type { CreateTaskGroupTaskInput, PendingInteraction, TaskView } from '@/types'

type GroupContext = {
  rootTask: TaskView
  members: TaskView[]
}

function shouldHydrateHierarchy(task: TaskView, allTasks: TaskView[]): boolean {
  const tasksById = new Map(allTasks.map((item) => [item.taskId, item]))
  if (task.parentTaskId && !tasksById.has(task.parentTaskId)) {
    return true
  }
  return (task.childTaskIds ?? []).some((childId) => !tasksById.has(childId))
}

function deriveGroupContext(task: TaskView, allTasks: TaskView[]): GroupContext {
  const tasksById = new Map<string, TaskView>(allTasks.map((item) => [item.taskId, item]))
  tasksById.set(task.taskId, task)

  // Walk to the highest available ancestor. In complete state this is the root task.
  let rootTask = task
  const visited = new Set<string>([task.taskId])
  while (rootTask.parentTaskId) {
    const parent = tasksById.get(rootTask.parentTaskId)
    if (!parent) break
    if (visited.has(parent.taskId)) break
    visited.add(parent.taskId)
    rootTask = parent
  }

  const belongsToRoot = (candidate: TaskView): boolean => {
    if (candidate.taskId === rootTask.taskId) return true
    const seen = new Set<string>()
    let current: TaskView | undefined = candidate
    while (current?.parentTaskId) {
      if (seen.has(current.taskId)) return false
      seen.add(current.taskId)
      if (current.parentTaskId === rootTask.taskId) return true
      current = tasksById.get(current.parentTaskId)
    }
    return false
  }

  const members = [...tasksById.values()]
    .filter((candidate) => belongsToRoot(candidate))
    .sort((a, b) => {
      if (a.taskId === rootTask.taskId) return -1
      if (b.taskId === rootTask.taskId) return 1
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

  return { rootTask, members }
}

export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const task = useTaskStore(s => s.tasks.find(t => t.taskId === taskId))
  const allTasks = useTaskStore(s => s.tasks) // Must be above early returns (Rules of Hooks)
  const fetchTask = useTaskStore(s => s.fetchTask)
  const fetchTasks = useTaskStore(s => s.fetchTasks)
  const [interaction, setInteraction] = useState<PendingInteraction | null>(null)
  const [tab, setTab] = useState<'conversation' | 'cooperation' | 'output' | 'events' | 'summary'>('conversation')
  const [taskLoading, setTaskLoading] = useState(false)
  const [taskNotFound, setTaskNotFound] = useState(false)
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false)
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
      setInteraction(prev => (prev ? null : prev))
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
  }, [taskId, task?.pendingInteractionId])

  // Hydrate task hierarchy so TaskDetail can derive complete group context.
  useEffect(() => {
    if (!taskId || !task) return
    if (allTasks.length > 1 && !shouldHydrateHierarchy(task, allTasks)) return

    const controller = new AbortController()
    fetchTasks({ signal: controller.signal })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error('[TaskDetailPage] Failed to fetch task hierarchy:', err)
        }
      })

    return () => controller.abort()
  }, [taskId, task, allTasks, fetchTasks])

  const groupContext = useMemo(
    () => (task ? deriveGroupContext(task, allTasks) : null),
    [task, allTasks]
  )

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

  const isActive = ['open', 'in_progress', 'awaiting_user', 'done'].includes(task.status)
  const canPause = task.status === 'in_progress'
  const canResume = task.status === 'paused'
  const canCancel = (isActive && task.status !== 'done') || task.status === 'paused'

  const isRootTask = !task.parentTaskId
  const groupRootTaskId = groupContext?.rootTask.taskId ?? task.taskId
  const groupRootTaskTitle = groupContext?.rootTask.title ?? task.title
  const hasGroupMembers = groupContext?.members.some((member) => member.taskId !== groupRootTaskId) ?? false

  const handleCreateGroup = async (tasks: CreateTaskGroupTaskInput[]) => {
    if (!isRootTask) {
      throw new Error('Only top-level tasks can create group members')
    }
    await api.createTaskGroup(task.taskId, { tasks })
    await fetchTasks()
  }

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
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-600 flex-wrap">
              <div className="flex items-center gap-4 min-w-0 flex-wrap">
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
              <p className="shrink-0">
                Root task:{' '}
                <Link to={`/tasks/${groupRootTaskId}`} className="text-violet-400 hover:text-violet-300">
                  {groupRootTaskTitle}
                </Link>
              </p>
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

      {/* ── Todo Queue ── */}
      <div className="shrink-0 py-2">
        <TaskTodoQueue todos={task.todos} />
      </div>

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
          <TabsTrigger value="cooperation" className="gap-1.5">
            <GitBranch className="h-3.5 w-3.5" /> Cooperation
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

        <TabsContent value="cooperation" className="flex-1 min-h-0 overflow-hidden mt-0 pt-2">
          <div className="h-full overflow-auto">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500 flex items-center gap-1">
                  <GitBranch size={12} /> Agent Group
                </p>
                {isRootTask && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowCreateGroupDialog(true)}
                  >
                    Create Group Members
                  </Button>
                )}
              </div>

              {hasGroupMembers ? (
                <div className="space-y-1">
                  {groupContext?.members.map((member) => (
                    <Link
                      key={member.taskId}
                      to={`/tasks/${member.taskId}`}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-900/40 hover:bg-accent/40 transition-colors"
                    >
                      <StatusBadge status={member.status} />
                      <span className="text-sm text-zinc-300 truncate flex-1">
                        {member.title}
                      </span>
                      {member.taskId === groupRootTaskId ? (
                        <span className="text-[10px] text-zinc-500 border border-zinc-700 rounded px-1">root</span>
                      ) : (
                        <span className="text-[10px] text-zinc-500 border border-zinc-700 rounded px-1">member</span>
                      )}
                      <span className="text-[10px] text-zinc-600">{timeAgo(member.updatedAt)}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 italic">No group members yet.</p>
              )}
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

      <CreateTaskGroupDialog
        open={showCreateGroupDialog}
        onClose={() => setShowCreateGroupDialog(false)}
        onCreate={handleCreateGroup}
      />
    </div>
  )
}
