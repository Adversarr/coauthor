/**
 * InteractionPanel — renders a pending user interaction and handles responses.
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import { CodeBlock } from '@/components/ai-elements/code-block'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { InteractionOption, PendingInteraction } from '@/types'

function getOptionVariant(style?: InteractionOption['style']): 'default' | 'destructive' | 'secondary' {
  if (style === 'danger') return 'destructive'
  if (style === 'default') return 'secondary'
  return 'default'
}

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
    <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <div>
        <h3 className="font-medium text-foreground">{interaction.display.title}</h3>
        {interaction.display.description && (
          <p className="mt-1 text-sm text-muted-foreground">{interaction.display.description}</p>
        )}
      </div>

      {interaction.display.content != null && (
        typeof interaction.display.content === 'string' && interaction.display.contentKind !== 'Json' ? (
          <pre className="max-h-60 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground">
            {interaction.display.content}
          </pre>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
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
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={getOptionVariant(opt.style)}
              disabled={submitting}
              onClick={() => respond(opt.id)}
              aria-label={`Select option: ${opt.label}`}
              className={cn(opt.isDefault && 'ring-1 ring-ring/60')}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      )}

      {/* Input field for Input / Composite kinds */}
      {(interaction.kind === 'Input' || interaction.kind === 'Composite') && (
        <div className="flex gap-2">
          <Input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Type your response…"
            className="h-8 flex-1 bg-background/70"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitting && inputValue.trim()) respond()
            }}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => respond()}
            disabled={submitting || !inputValue.trim()}
            aria-label="Send response"
          >
            Send
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
