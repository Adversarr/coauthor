/**
 * InteractionPanel — renders a pending user interaction and handles responses.
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import { CodeBlock } from '@/components/ai-elements/code-block'
import type { PendingInteraction } from '@/types'

export function InteractionPanel({ interaction }: { interaction: PendingInteraction }) {
  const [submitting, setSubmitting] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const respond = async (selectedOptionId?: string) => {
    setSubmitting(true)
    setError(null)
    try {
      await api.respondToInteraction(interaction.taskId, interaction.interactionId, {
        selectedOptionId,
        inputValue: inputValue || undefined,
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-4 space-y-3">
      <div>
        <h3 className="font-medium text-amber-200">{interaction.display.title}</h3>
        {interaction.display.description && (
          <p className="text-sm text-zinc-400 mt-1">{interaction.display.description}</p>
        )}
      </div>

      {interaction.display.content != null && (
        typeof interaction.display.content === 'string' && interaction.display.contentKind !== 'Json' ? (
          <pre className="text-xs bg-zinc-900 rounded p-3 overflow-x-auto overflow-y-auto max-h-60 text-zinc-300 border border-zinc-800">
            {interaction.display.content}
          </pre>
        ) : (
          <div className="rounded-md border border-zinc-800 overflow-hidden">
            <CodeBlock
              code={typeof interaction.display.content === 'string'
                ? interaction.display.content
                : JSON.stringify(interaction.display.content, null, 2)}
              language={interaction.display.contentKind === 'Diff' ? 'diff' : 'json'}
            />
          </div>
        )
      )}

      {/* Select / Confirm options */}
      {interaction.options && interaction.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {interaction.options.map(opt => (
            <button
              key={opt.id}
              disabled={submitting}
              onClick={() => respond(opt.id)}
              aria-label={`Select option: ${opt.label}`}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50',
                opt.style === 'primary' && 'bg-violet-600 hover:bg-violet-500 text-white',
                opt.style === 'danger' && 'bg-red-700 hover:bg-red-600 text-white',
                (!opt.style || opt.style === 'default') && 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Input field for Input / Composite kinds */}
      {(interaction.kind === 'Input' || interaction.kind === 'Composite') && (
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Type your response…"
            className="flex-1 rounded-md bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            onKeyDown={e => e.key === 'Enter' && !submitting && inputValue.trim() && respond()}
          />
          <button
            onClick={() => respond()}
            disabled={submitting || !inputValue.trim()}
            aria-label="Send response"
            className="px-4 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
