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
  SelectValue,
} from '@/components/ui/select'
import { Bot } from 'lucide-react'

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

  useEffect(() => {
    if (agents.length === 0 && !loading) {
      fetchRuntime()
    }
  }, [agents.length, loading, fetchRuntime])

  if (agents.length === 0) return null

  return (
    <Select
      value={value ?? defaultAgentId ?? undefined}
      onValueChange={onChange}
    >
      <SelectTrigger className={className}>
        <div className="flex items-center gap-2">
          <Bot className="h-3.5 w-3.5 text-zinc-500" />
          <SelectValue placeholder="Select agent" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {agents.map(agent => (
          <SelectItem key={agent.id} value={agent.id}>
            <div>
              <span className="font-medium">{agent.displayName}</span>
              {agent.id === defaultAgentId && (
                <span className="ml-1.5 text-[10px] text-zinc-500">(default)</span>
              )}
              {agent.description && (
                <p className="text-xs text-zinc-500 mt-0.5">{agent.description}</p>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
