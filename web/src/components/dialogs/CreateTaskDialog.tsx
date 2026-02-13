/**
 * CreateTaskDialog — modal form for creating a new task.
 *
 * Includes agent selection from runtime store.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { api } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AgentSelector } from '@/components/navigation/AgentSelector'

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: (taskId: string) => void
}

export function CreateTaskDialog({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [intent, setIntent] = useState('')
  const [agentId, setAgentId] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const intentId = useId()

  useEffect(() => {
    if (open) {
      setTitle('')
      setIntent('')
      setAgentId(undefined) // Reset agent selection on re-open
      setError(null)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const { taskId } = await api.createTask({
        title: title.trim(),
        intent: intent.trim() || undefined,
        agentId: agentId || undefined,
      })
      onCreated?.(taskId)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent
        className="max-w-[calc(100vw-2rem)] sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={titleId}>Title</Label>
            <Input
              id={titleId}
              ref={inputRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What should the agent do?"
              className="max-w-full"
            />
          </div>

          <div className="grid min-w-0 gap-2">
            <Label htmlFor={intentId}>Intent (optional)</Label>
            <Textarea
              id={intentId}
              value={intent}
              onChange={e => setIntent(e.target.value)}
              placeholder="Additional context or instructions…"
              rows={3}
              className="max-w-full"
            />
          </div>

          <div className="grid min-w-0 gap-2">
            <Label>Agent</Label>
            <AgentSelector value={agentId} onChange={setAgentId} className="min-w-0 max-w-full" />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? 'Creating…' : 'Create Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
