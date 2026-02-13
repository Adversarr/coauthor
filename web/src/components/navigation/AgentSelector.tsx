/**
 * AgentSelector — dropdown to pick an agent for task creation.
 *
 * Uses runtime store to fetch available agents.
 * Falls back gracefully when runtime data isn't loaded yet.
 */

import { useEffect } from 'react'
import { useRuntimeStore } from '@/stores/runtimeStore'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Bot } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AgentSelectorProps {
  value?: string
  onChange: (agentId: string) => void
  className?: string
}

export function AgentSelector({ value, onChange, className }: AgentSelectorProps) {
  const agents = useRuntimeStore(s => s.agents)
  const defaultAgentId = useRuntimeStore(s => s.defaultAgentId)
  const loading = useRuntimeStore(s => s.loading)
  const fetchRuntime = useRuntimeStore(s => s.fetchRuntime)
  const selectedAgentId = value ?? defaultAgentId ?? undefined
  const selectedAgent = agents.find(agent => agent.id === selectedAgentId)

  useEffect(() => {
    if (agents.length === 0 && !loading) {
      fetchRuntime()
    }
  }, [agents.length, loading, fetchRuntime])

  if (agents.length === 0) return null

  return (
    <Select
      value={selectedAgentId}
      onValueChange={onChange}
    >
      <SelectTrigger className={cn('min-w-0 max-w-full', className)}>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <Bot className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <div className="min-w-0 flex-1 overflow-hidden text-left">
            <p className="truncate">
              {selectedAgent ? selectedAgent.displayName : 'Select agent'}
            </p>
          </div>
        </div>
      </SelectTrigger>
      <SelectContent className="max-w-[var(--radix-select-trigger-width)]">
        {agents.map(agent => (
          <SelectItem key={agent.id} value={agent.id}>
            <div className="min-w-0">
              <span className="font-medium">{agent.displayName}</span>
              {agent.id === defaultAgentId && (
                <span className="ml-1.5 text-[10px] text-zinc-500">(default)</span>
              )}
              {agent.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{agent.description}</p>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
