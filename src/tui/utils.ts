import { parse, setOptions } from 'marked'
import type { Renderer } from 'marked'
import TerminalRenderer from 'marked-terminal'
import type { StoredAuditEntry } from '../domain/ports/auditLog.js'
import type { TaskView } from './types.js'

export function renderMarkdownToTerminalText(markdown: string, width: number): string {
  if (!markdown) return ''
  const safeWidth = Math.max(20, width)
  const renderer = new TerminalRenderer({
    width: safeWidth,
    reflowText: true,
    showSectionPrefix: false
  }) as unknown as Renderer
  setOptions({
    renderer
  })
  return parse(markdown).trimEnd()
}

export function getStatusIcon(status: string): string {
  switch (status) {
    case 'open': return '⚪'
    case 'in_progress': return '🔵'
    case 'awaiting_user': return '🟡'
    case 'paused': return '⏸️'
    case 'done': return '🟢'
    case 'failed': return '🔴'
    case 'canceled': return '⚪'
    default: return ' '
  }
}

/**
 * Get a short status label for compact display.
 */
export function getStatusLabel(status: string): string {
  switch (status) {
    case 'open': return 'OPEN'
    case 'in_progress': return 'RUNNING'
    case 'awaiting_user': return 'WAITING'
    case 'paused': return 'PAUSED'
    case 'done': return 'DONE'
    case 'failed': return 'FAILED'
    case 'canceled': return 'CANCELED'
    default: return status.toUpperCase()
  }
}

export function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if (value.length <= maxLength) return value
  return value.slice(0, Math.max(0, maxLength - 1)) + '…'
}

export function createSeparatorLine(columns: number): string {
  const width = Math.max(0, columns)
  return '─'.repeat(width)
}

// ============================================================================
// Tree Sorting
// ============================================================================

/**
 * Sort tasks into depth-first tree order.
 * Root tasks appear first (in their original order), each followed
 * immediately by their subtasks (recursively).
 */
export function sortTasksAsTree(tasks: TaskView[]): TaskView[] {
  const byParent = new Map<string | undefined, TaskView[]>()
  for (const task of tasks) {
    const key = task.parentTaskId ?? '__root__'
    const group = byParent.get(key) ?? []
    group.push(task)
    byParent.set(key, group)
  }

  const result: TaskView[] = []
  function walk(parentId: string | undefined) {
    const key = parentId ?? '__root__'
    const children = byParent.get(key)
    if (!children) return
    for (const child of children) {
      result.push(child)
      walk(child.taskId)
    }
  }
  walk(undefined)
  return result
}

/**
 * Compute the depth of each task (0 for root, 1 for child, etc.)
 * from a flat task list. Returns a Map<taskId, depth>.
 */
export function computeTaskDepths(tasks: TaskView[]): Map<string, number> {
  const depths = new Map<string, number>()
  const byId = new Map<string, TaskView>()
  for (const t of tasks) byId.set(t.taskId, t)

  function getDepth(task: TaskView): number {
    if (depths.has(task.taskId)) return depths.get(task.taskId)!
    if (!task.parentTaskId) {
      depths.set(task.taskId, 0)
      return 0
    }
    const parent = byId.get(task.parentTaskId)
    const d = parent ? getDepth(parent) + 1 : 0
    depths.set(task.taskId, d)
    return d
  }

  for (const task of tasks) getDepth(task)
  return depths
}

// ============================================================================
// Breadcrumb Trail
// ============================================================================

/**
 * Build a breadcrumb trail from the focused task up to the root.
 * Returns an array like ["Root Task", "Parent", "Current"] (root first).
 */
export function buildBreadcrumb(tasks: TaskView[], focusedTaskId: string | null): string[] {
  if (!focusedTaskId) return []
  const byId = new Map<string, TaskView>()
  for (const t of tasks) byId.set(t.taskId, t)

  const trail: string[] = []
  let current = byId.get(focusedTaskId)
  while (current) {
    trail.unshift(truncateText(current.title, 20))
    current = current.parentTaskId ? byId.get(current.parentTaskId) : undefined
  }
  return trail
}

/**
 * Get a summary of child task statuses for a parent task.
 * e.g. "2/3 done" or "1 running"
 */
export function getChildStatusSummary(task: TaskView, allTasks: TaskView[]): string {
  const childIds = task.childTaskIds
  if (!childIds || childIds.length === 0) return ''
  const children = allTasks.filter(t => childIds.includes(t.taskId))
  const total = children.length
  const done = children.filter(t => t.status === 'done').length
  const running = children.filter(t => t.status === 'in_progress').length
  const failed = children.filter(t => t.status === 'failed').length

  if (done === total) return `${total}/${total} done`
  const parts: string[] = []
  if (done > 0) parts.push(`${done} done`)
  if (running > 0) parts.push(`${running} running`)
  if (failed > 0) parts.push(`${failed} failed`)
  return parts.length > 0 ? `${parts.join(', ')} of ${total}` : `${total} subtask${total > 1 ? 's' : ''}`
}

// ============================================================================
// Tree Indent Prefixes
// ============================================================================

/**
 * Get the tree-drawing prefix for a task at the given depth.
 * Returns characters like "  ├─ " or "  └─ " depending on position.
 */
export function getTreePrefix(task: TaskView, allTasks: TaskView[], depth: number): string {
  if (depth === 0) return ''
  // Find siblings (tasks with the same parent)
  const siblings = allTasks.filter(t => t.parentTaskId === task.parentTaskId)
  const isLast = siblings.indexOf(task) === siblings.length - 1
  const connector = isLast ? '└─' : '├─'
  const indent = '│ '.repeat(Math.max(0, depth - 1))
  return `${indent}${connector} `
}

function truncateLongString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const suffix = '...(truncated)'
  const sliceLength = Math.max(0, maxLength - suffix.length)
  return value.slice(0, sliceLength) + suffix
}

export function formatToolPayload(value: unknown, maxLength: number): string {
  if (typeof value === 'string') {
    return truncateLongString(value, maxLength)
  }
  try {
    // Try pretty print for small objects
    const pretty = JSON.stringify(value, null, 2)
    if (pretty.length <= maxLength) return pretty
    // Fallback to compact JSON for larger objects
    const raw = JSON.stringify(value)
    if (raw.length <= maxLength) return raw
    return truncateLongString(raw, maxLength)
  } catch {
    return String(value)
  }
}

export const toolFormatters: Record<string, (output: any) => string | null> = {
  readFile: (output: any) => {
    if (output && typeof output.path === 'string' && typeof output.lineCount === 'number') {
      return `Read ${output.path} (${output.lineCount} lines)`
    }
    // Handle direct string output (legacy)
    if (typeof output === 'string') {
      const lineCount = output.split('\n').length
      return `Read ${lineCount} lines`
    }
    return null
  },
  listFiles: (output: any) => {
    if (output && typeof output.path === 'string' && typeof output.count === 'number') {
      return `List ${output.path} (${output.count} entries)`
    }
    // Handle array output
    if (Array.isArray(output)) {
      return `List ${output.length} entries`
    }
    return null
  },
  ls: (output: any) => {
    // Alias for listFiles formatter
    if (Array.isArray(output)) return `List ${output.length} entries`
    return null
  },
  globTool: (output: any) => {
    if (Array.isArray(output)) {
      return `Found ${output.length} matching files`
    }
    return null
  },
  grepTool: (output: any) => {
    if (typeof output === 'string') {
      const matchCount = output.trim() ? output.trim().split('\n').length : 0
      return `Found ${matchCount} matches`
    }
    return null
  },
  search: (output: any) => {
    // Alias for grepTool
    if (typeof output === 'string') {
      const matchCount = output.trim() ? output.trim().split('\n').length : 0
      return `Found ${matchCount} matches`
    }
    return null
  },
  runCommand: (output: any) => {
    if (output && typeof output.exitCode === 'number') {
      const status = output.exitCode === 0 ? 'Success' : `Exit ${output.exitCode}`
      const preview = output.stdout ? output.stdout.trim().slice(0, 50) : (output.stderr ? output.stderr.trim().slice(0, 50) : '')
      const suffix = preview ? ` | ${preview.replace(/\n/g, ' ')}...` : ''
      return `${status}${suffix}`
    }
    return null
  },
  editFile: (output: any) => {
    if (typeof output === 'string') return output // Usually "Applied replacement to..."
    return null
  }
}

export function formatToolOutput(toolName: string, output: any): string {
  const formatter = toolFormatters[toolName]
  const formattedCustom = formatter ? formatter(output) : null
  if (formattedCustom) {
    return formattedCustom
  }
  return formatToolPayload(output, 200)
}

export function formatAuditEntry(entry: StoredAuditEntry): {
  line: string
  color?: string
  dim?: boolean
  bold?: boolean
} {
  if (entry.type === 'ToolCallRequested') {
    const input = formatToolPayload(entry.payload.input, 200)
    return {
      line: ` → ${entry.payload.toolName} ${input}`,
      color: 'blue',
      dim: false
    }
  }

  const output = formatToolOutput(entry.payload.toolName, entry.payload.output)

  if (entry.payload.isError) {
    return {
      line: ` ✖ ${entry.payload.toolName} error (${entry.payload.durationMs}ms) ${output}`,
      color: 'red',
      bold: true
    }
  }
  return {
    line: ` ✓ ${entry.payload.toolName} ok (${entry.payload.durationMs}ms) ${output}`,
    color: 'blue',
    dim: true
  }
}

export function buildCommandLineFromInput(opts: {
  input: string
  focusedTaskId: string | null
  tasks: TaskView[]
}): string {
  const trimmed = opts.input.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/')) return trimmed

  if (!opts.focusedTaskId) {
    return `/new ${trimmed}`
  }

  const focusedTask = opts.tasks.find((task) => task.taskId === opts.focusedTaskId)
  const focusedTaskStatus = focusedTask?.status

  if (focusedTaskStatus === 'awaiting_user') {
    return `/continue ${trimmed}`
  }

  return `/continue ${trimmed}`
}
