/**
 * StatusBadge — colored pill for task status.
 */

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { TaskStatus } from '@/types'

const statusConfig: Record<
  TaskStatus,
  {
    label: string
    className: string
  }
> = {
  open:          { label: 'Open',          className: 'bg-zinc-700 text-zinc-200 border-transparent' },
  in_progress:   { label: 'Running',       className: 'bg-violet-900/60 text-violet-200 border-transparent animate-pulse' },
  awaiting_user: { label: 'Awaiting User', className: 'bg-amber-900/60 text-amber-200 border-transparent' },
  paused:        { label: 'Paused',        className: 'bg-zinc-600 text-zinc-100 border-transparent' },
  done:          { label: 'Done',          className: 'bg-emerald-900/60 text-emerald-200 border-transparent' },
  failed:        { label: 'Failed',        className: 'bg-red-900/60 text-red-200 border-transparent' },
  canceled:      { label: 'Canceled',      className: 'bg-zinc-700 text-zinc-400 border-transparent line-through' },
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const config = statusConfig[status] ?? statusConfig.open
  return (
    <Badge
      className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', config.className)}
    >
      {config.label}
    </Badge>
  )
}
