import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, ListTodo } from 'lucide-react'
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from '@/components/ai-elements/queue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { TaskTodoItem } from '@/types'

type TaskTodoQueueProps = {
  todos?: TaskTodoItem[]
  className?: string
}

export function TaskTodoQueue({ todos, className }: TaskTodoQueueProps) {
  const items = todos ?? []
  const pending = items.filter((todo) => todo.status === 'pending')
  const completed = items.filter((todo) => todo.status === 'completed')
  const shouldAutoCollapse = pending.length === 0
  const [open, setOpen] = useState(!shouldAutoCollapse)

  // Always collapse when there are no pending items (empty or fully completed queue).
  useEffect(() => {
    if (shouldAutoCollapse) setOpen(false)
  }, [shouldAutoCollapse])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Queue className={className}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group -mx-1 mb-1 flex items-center justify-between rounded-md px-2 py-1 text-left hover:bg-zinc-900/60"
          >
            <span className="text-xs text-zinc-500">Todo Queue</span>
            <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
              {pending.length} pending
              <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-2">
          <QueueSection defaultOpen>
            <QueueSectionTrigger>
              <QueueSectionLabel
                count={pending.length}
                icon={<ListTodo className="size-4" />}
                label="Pending"
              />
            </QueueSectionTrigger>
            <QueueSectionContent>
              {pending.length === 0 ? (
                <p className="px-3 py-2 text-xs text-zinc-500 italic">No pending todos.</p>
              ) : (
                <QueueList>
                  {pending.map((todo) => (
                    <QueueItem key={todo.id}>
                      <div className="flex items-start gap-2">
                        <QueueItemIndicator completed={false} />
                        <QueueItemContent completed={false}>{todo.title}</QueueItemContent>
                      </div>
                      {todo.description ? (
                        <QueueItemDescription completed={false}>
                          {todo.description}
                        </QueueItemDescription>
                      ) : null}
                    </QueueItem>
                  ))}
                </QueueList>
              )}
            </QueueSectionContent>
          </QueueSection>

          <QueueSection defaultOpen>
            <QueueSectionTrigger>
              <QueueSectionLabel
                count={completed.length}
                icon={<CheckCircle2 className="size-4" />}
                label="Completed"
              />
            </QueueSectionTrigger>
            <QueueSectionContent>
              {completed.length === 0 ? (
                <p className="px-3 py-2 text-xs text-zinc-500 italic">No completed todos.</p>
              ) : (
                <QueueList>
                  {completed.map((todo) => (
                    <QueueItem key={todo.id}>
                      <div className="flex items-start gap-2">
                        <QueueItemIndicator completed />
                        <QueueItemContent completed>{todo.title}</QueueItemContent>
                      </div>
                      {todo.description ? (
                        <QueueItemDescription completed>
                          {todo.description}
                        </QueueItemDescription>
                      ) : null}
                    </QueueItem>
                  ))}
                </QueueList>
              )}
            </QueueSectionContent>
          </QueueSection>
        </CollapsibleContent>
      </Queue>
    </Collapsible>
  )
}
