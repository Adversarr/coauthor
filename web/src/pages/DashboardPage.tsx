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
          <button
            onClick={() => fetchTasks()}
            className="p-2 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            New Task
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
        {(['all', 'active', 'done'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize',
              filter === f ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {f}
          </button>
        ))}
      </div>

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
              className="w-full flex items-center gap-4 px-4 py-3 rounded-lg bg-zinc-900/50 border border-zinc-800/50 hover:bg-zinc-800/60 hover:border-zinc-700/50 transition-all text-left group"
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
