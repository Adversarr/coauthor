/**
 * StreamOutput — renders live agent streaming output for a task.
 */

import { useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useStreamStore } from '@/stores'

type StreamChunk = {
  kind: 'text' | 'reasoning' | 'verbose' | 'error'
  content: string
  timestamp: number
}

const EMPTY_ARRAY: StreamChunk[] = []

export function StreamOutput({ taskId }: { taskId: string }) {
  const chunks = useStreamStore(s => s.streams[taskId] ?? EMPTY_ARRAY)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chunks.length])

  if (chunks.length === 0) return null

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden">
      <div className="px-3 py-1.5 text-xs font-medium text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
        Agent Output
      </div>
      <div className="max-h-96 overflow-y-auto p-3 space-y-1 font-mono text-sm">
        {chunks.map((chunk, i) => (
          <div
            key={i}
            className={cn(
              'whitespace-pre-wrap break-words',
              chunk.kind === 'error' && 'text-red-400',
              chunk.kind === 'reasoning' && 'text-zinc-500 italic',
              chunk.kind === 'verbose' && 'text-zinc-600',
              chunk.kind === 'text' && 'text-zinc-200',
            )}
          >
            {chunk.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
