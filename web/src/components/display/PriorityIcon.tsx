/**
 * PriorityIcon — visual indicator for task priority.
 */

import { ArrowUp, Minus, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TaskPriority } from '@/types'

const config: Record<TaskPriority, { icon: typeof ArrowUp; className: string; label: string }> = {
  foreground: { icon: ArrowUp,    className: 'text-amber-400',  label: 'Foreground' },
  normal:     { icon: Minus,      className: 'text-zinc-500',   label: 'Normal' },
  background: { icon: ArrowDown,  className: 'text-zinc-600',   label: 'Background' },
}

export function PriorityIcon({ priority, showLabel = false }: { priority: TaskPriority; showLabel?: boolean }) {
  const c = config[priority] ?? config.normal
  const Icon = c.icon
  return (
    <span className={cn('inline-flex items-center gap-1', c.className)} title={c.label}>
      <Icon size={14} />
      {showLabel && <span className="text-xs">{c.label}</span>}
    </span>
  )
}
