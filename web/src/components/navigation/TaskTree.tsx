/**
 * TaskTree — hierarchical tree view of tasks showing parent-child relationships.
 *
 * Renders a recursive tree structure from the flat task list.  Each node shows
 * status, title, and a "streaming" indicator when that task's agent is still
 * producing output.  Clicking a node navigates to the task detail page.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/utils'
import { useTaskStore, useStreamStore } from '@/stores'
import { StatusBadge } from '@/components/display/StatusBadge'
import { Shimmer } from '@/components/ai-elements/shimmer'
import type { TaskView } from '@/types'

interface TreeNode {
  task: TaskView
  children: TreeNode[]
}

/** Build a forest (list of root trees) from a flat task list. */
function buildTree(tasks: TaskView[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  for (const t of tasks) map.set(t.taskId, { task: t, children: [] })

  const roots: TreeNode[] = []
  for (const node of map.values()) {
    if (node.task.parentTaskId && map.has(node.task.parentTaskId)) {
      map.get(node.task.parentTaskId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function TreeNodeRow({ node, depth, activeTaskId }: { node: TreeNode; depth: number; activeTaskId?: string }) {
  const isActive = node.task.taskId === activeTaskId
  const stream = useStreamStore(s => s.streams[node.task.taskId])
  const hasStream = !!stream && !stream.completed
  const hasChildren = node.children.length > 0

  return (
    <>
      <Link
        to={`/tasks/${node.task.taskId}`}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 px-3 py-1.5 rounded-md hover:bg-accent/40 transition-colors text-left group',
          isActive && 'bg-accent/30 ring-1 ring-accent',
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {hasChildren ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/80" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <StatusBadge status={node.task.status} />
        <span className={cn(
          'text-sm truncate flex-1',
          isActive ? 'font-medium text-foreground' : 'text-muted-foreground group-hover:text-foreground',
        )}>
          {node.task.title}
        </span>
        {hasStream && <Shimmer className="h-2.5 shrink-0">…</Shimmer>}
        <span className="text-[10px] shrink-0 text-muted-foreground/80">{timeAgo(node.task.updatedAt)}</span>
      </Link>
      {node.children.map(child => (
        <TreeNodeRow key={child.task.taskId} node={child} depth={depth + 1} activeTaskId={activeTaskId} />
      ))}
    </>
  )
}

interface TaskTreeProps {
  activeTaskId?: string
  className?: string
}

export function TaskTree({ activeTaskId, className }: TaskTreeProps) {
  const tasks = useTaskStore(s => s.tasks)
  const roots = useMemo(() => buildTree(tasks), [tasks])

  if (roots.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8 text-muted-foreground', className)}>
        <GitBranch className="h-6 w-6 mb-2" />
        <p className="text-xs">No tasks</p>
      </div>
    )
  }

  return (
    <nav className={cn('w-full min-w-0 space-y-0.5 overflow-hidden', className)} aria-label="Task tree">
      {roots.map(node => (
        <TreeNodeRow key={node.task.taskId} node={node} depth={0} activeTaskId={activeTaskId} />
      ))}
    </nav>
  )
}
