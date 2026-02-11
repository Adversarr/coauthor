/**
 * Dashboard page — task list overview with real-time updates.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ListTodo, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { timeAgo, truncate } from '@/lib/utils'
import { useTaskStore } from '@/stores'
import { StatusBadge } from '@/components/StatusBadge'
import { PriorityIcon } from '@/components/PriorityIcon'
import { CreateTaskDialog } from '@/components/CreateTaskDialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { TaskView, TaskStatus } from '@/types'

const STATUS_ORDER: TaskStatus[] = ['in_progress', 'awaiting_user', 'open', 'paused', 'done', 'failed', 'canceled']

function sortTasks(tasks: TaskView[]): TaskView[] {
  return [...tasks].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status)
    const bi = STATUS_ORDER.indexOf(b.status)
    if (ai !== bi) return ai - bi
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

export function DashboardPage() {
  const tasks = useTaskStore(s => s.tasks)
  const loading = useTaskStore(s => s.loading)
  const fetchTasks = useTaskStore(s => s.fetchTasks)
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all')
  const navigate = useNavigate()

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const filtered = sortTasks(
    filter === 'all' ? tasks
    : filter === 'active' ? tasks.filter(t => !['done', 'failed', 'canceled'].includes(t.status))
    : tasks.filter(t => ['done', 'failed', 'canceled'].includes(t.status))
  )

  const activeTasks = tasks.filter(t => !['done', 'failed', 'canceled'].includes(t.status))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Tasks</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {activeTasks.length} active · {tasks.length} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fetchTasks()}
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-4 w-4" />
            New Task
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList className="bg-zinc-900">
          <TabsTrigger value="all" className="capitalize">all</TabsTrigger>
          <TabsTrigger value="active" className="capitalize">active</TabsTrigger>
          <TabsTrigger value="done" className="capitalize">done</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Task List */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <ListTodo size={48} strokeWidth={1} className="mb-4 text-zinc-700" />
          <p className="text-lg font-medium">No tasks yet</p>
          <p className="text-sm mt-1">Create your first task to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(task => (
            <button
              key={task.taskId}
              onClick={() => navigate(`/tasks/${task.taskId}`)}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-lg bg-card border border-border hover:bg-accent/40 transition-colors text-left group"
            >
              <PriorityIcon priority={task.priority} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate group-hover:text-zinc-100">
                    {task.title}
                  </span>
                  {task.parentTaskId && (
                    <span className="text-[10px] text-zinc-600 bg-zinc-800 px-1 rounded">subtask</span>
                  )}
                </div>
                {task.intent && (
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">{truncate(task.intent, 120)}</p>
                )}
              </div>
              <StatusBadge status={task.status} />
              <span className="text-xs text-zinc-600 w-16 text-right shrink-0">{timeAgo(task.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}

      <CreateTaskDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => navigate(`/tasks/${id}`)}
      />
    </div>
  )
}
