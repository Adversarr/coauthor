/**
 * PromptBar — input area for sending instructions to the agent.
 *
 * Fixed at the bottom of the conversation view. Supports:
 * - Text instructions
 * - Enter to send, Shift+Enter for newline
 * - Disabled state when task is not active
 */

import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ArrowUp, Loader2 } from 'lucide-react'

interface PromptBarProps {
  taskId: string
  disabled?: boolean
  className?: string
}

export function PromptBar({ taskId, disabled = false, className }: PromptBarProps) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(async () => {
    const text = value.trim()
    if (!text || sending || disabled) return

    setSending(true)
    setError(null)
    try {
      await api.addInstruction(taskId, text)
      setValue('')
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } catch (err) {
      console.error('[PromptBar] Failed to send instruction:', err)
      setError((err as Error).message || 'Failed to send instruction')
    } finally {
      setSending(false)
    }
  }, [value, sending, disabled, taskId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // Auto-resize textarea
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  return (
    <div className={cn('space-y-2', className)}>
      <div className={cn(
        'flex items-end gap-2 rounded-xl border border-border bg-card p-2',
        disabled && 'opacity-50',
      )}>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Task is not active' : 'Send instruction to the agent…'}
          disabled={disabled || sending}
          rows={1}
          className={cn(
            'min-h-[40px] max-h-[200px] resize-none border-0 bg-transparent shadow-none',
            'focus-visible:ring-0 focus-visible:ring-offset-0',
            'placeholder:text-zinc-600',
          )}
        />
        <Button
          size="icon"
          disabled={disabled || sending || !value.trim()}
          onClick={handleSend}
          className="h-8 w-8 shrink-0 rounded-lg"
          aria-label="Send instruction"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-400 px-2">{error}</p>
      )}
    </div>
  )
}
