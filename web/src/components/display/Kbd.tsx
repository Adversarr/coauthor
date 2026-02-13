/**
 * Kbd — keyboard key indicator used in the Settings shortcuts reference.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface KbdProps {
  children: ReactNode
  className?: string
}

export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded border',
        'border-border bg-muted text-xs text-muted-foreground font-mono shadow-sm',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
