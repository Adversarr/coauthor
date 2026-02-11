/**
 * StreamOutput — renders live agent streaming output for a task.
 */

import { useMemo } from 'react'
import { useStreamStore } from '@/stores'
import { Terminal, TerminalContent, TerminalHeader, TerminalTitle } from '@/components/ai-elements/terminal'

type StreamChunk = {
  kind: 'text' | 'reasoning' | 'verbose' | 'error'
  content: string
  timestamp: number
}

const EMPTY_ARRAY: StreamChunk[] = []

function chunkToAnsi(chunk: StreamChunk): string {
  switch (chunk.kind) {
    case 'error':
      return `\u001b[31m${chunk.content}\u001b[0m`
    case 'reasoning':
      return `\u001b[2m${chunk.content}\u001b[0m`
    case 'verbose':
      return `\u001b[2m${chunk.content}\u001b[0m`
    case 'text':
      return chunk.content
  }
}

export function StreamOutput({ taskId }: { taskId: string }) {
  const chunks = useStreamStore(s => s.streams[taskId] ?? EMPTY_ARRAY)
  const clearStream = useStreamStore(s => s.clearStream)

  const output = useMemo(() => chunks.map(chunkToAnsi).join(''), [chunks])

  if (chunks.length === 0) return null

  return (
    <Terminal output={output} onClear={() => clearStream(taskId)} className="border-border bg-zinc-950">
      <TerminalHeader>
        <TerminalTitle>Agent Output</TerminalTitle>
      </TerminalHeader>
      <TerminalContent />
    </Terminal>
  )
}
