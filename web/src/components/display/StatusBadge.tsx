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
  open:          { label: 'Open',          className: 'border-border bg-secondary text-secondary-foreground' },
  in_progress:   { label: 'Running',       className: 'animate-pulse border-primary/30 bg-primary/20 text-primary' },
  awaiting_user: { label: 'Awaiting User', className: 'border-amber-500/30 bg-amber-500/15 text-amber-200' },
  paused:        { label: 'Paused',        className: 'border-border bg-muted text-muted-foreground' },
  done:          { label: 'Done',          className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200' },
  failed:        { label: 'Failed',        className: 'border-destructive/40 bg-destructive/20 text-destructive' },
  canceled:      { label: 'Canceled',      className: 'border-border bg-muted text-muted-foreground line-through' },
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
