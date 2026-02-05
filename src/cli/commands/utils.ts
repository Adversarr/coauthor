/**
 * Helper to get a status icon for display in the CLI
 */
export function getStatusIcon(status: string): string {
  switch (status) {
    case 'open': return '○'
    case 'in_progress': return '◐'
    case 'awaiting_user': return '◇'
    case 'done': return '●'
    case 'failed': return '✗'
    case 'canceled': return '⊘'
    default: return '?'
  }
}
