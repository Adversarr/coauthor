/**
 * Tool formatters for displaying tool inputs and outputs in a human-readable format.
 * Used by TUI and potentially browser interfaces.
 */

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
    return null
  },
  listFiles: (output: any) => {
    if (output && typeof output.path === 'string' && typeof output.count === 'number') {
      return `List ${output.path} (${output.count} entries)`
    }
    if (output && typeof output.content === 'string' && typeof output.count === 'number') {
      const match = output.content.match(/Directory listing for ([^:\n]+):/)
      const inferredPath = match ? match[1] : undefined
      if (inferredPath) {
        return `List ${inferredPath} (${output.count} entries)`
      }
      return `List ${output.count} entries`
    }
    return null
  },
  ls: (output: any) => {
    // Alias for listFiles formatter
    if (Array.isArray(output)) return `List ${output.length} entries`
    return null
  },
  globTool: (output: any) => {
    // Tool returns { matches: string[], count: number, content: string }
    if (output && Array.isArray(output.matches) && typeof output.count === 'number') {
      return `Found ${output.count} matching files`
    }
    return null
  },
  grepTool: (output: any) => {
    // Tool returns { content: string, count: number, strategy: string }
    if (output && typeof output.content === 'string' && typeof output.count === 'number') {
      return `Found ${output.count} matches`
    }
    return null
  },
  search: (output: any) => {
    // Alias for grepTool - Tool returns { content: string, count: number, strategy: string }
    if (output && typeof output.count === 'number') {
      return `Found ${output.count} matches`
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
    if (typeof output === 'string') return output
    if (output && output.success && typeof output.path === 'string') {
      const action = output.action === 'created' ? 'Created' : 'Edited'
      const strategy = output.strategy ? ` (${output.strategy})` : ''
      return `${action} ${output.path}${strategy}`
    }
    return null
  },
  createSubtasks: (output: any) => {
    if (!output || !Array.isArray(output.tasks)) return null
    const total = output.tasks.length
    const summary = output.summary
    if (summary && typeof summary.success === 'number' && typeof summary.error === 'number' && typeof summary.cancel === 'number') {
      return `Subtasks: ${summary.success} success, ${summary.error} error, ${summary.cancel} canceled`
    }
    return `Created ${total} subtasks`
  },
  listSubtask: (output: any) => {
    if (output && typeof output.total === 'number') {
      return `List ${output.total} sub-agents`
    }
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

export const toolInputFormatters: Record<string, (input: any) => string | null> = {
  readFile: (input: any) => {
    if (input && typeof input.path === 'string') {
      let suffix = ''
      if (typeof input.offset === 'number' && typeof input.limit === 'number') {
        suffix = ` (lines ${input.offset + 1}-${input.offset + input.limit})`
      }
      return `Read ${input.path}${suffix}`
    }
    return null
  },
  editFile: (input: any) => {
    if (input && typeof input.path === 'string') {
      const isCreate = input.oldString === ''
      if (isCreate) return `Create ${input.path}`
      const suffix = input.regex ? ' (regex)' : ''
      return `Edit ${input.path}${suffix}`
    }
    return null
  },
  listFiles: (input: any) => {
    if (input && typeof input.path === 'string') {
      const ignore = Array.isArray(input.ignore) && input.ignore.length > 0
        ? ` (ignoring: ${input.ignore.join(', ')})`
        : ''
      return `List ${input.path}${ignore}`
    }
    return null
  },
  runCommand: (input: any) => {
    if (input && typeof input.command === 'string') {
      const suffix = input.isBackground ? ' (background)' : ''
      return `Run "${input.command}"${suffix}`
    }
    return null
  },
  globTool: (input: any) => {
    if (input && typeof input.pattern === 'string') {
      const ignore = Array.isArray(input.ignore) && input.ignore.length > 0
        ? ` (ignoring: ${input.ignore.join(', ')})`
        : ''
      return `Glob "${input.pattern}"${ignore}`
    }
    return null
  },
  grepTool: (input: any) => {
    if (input && typeof input.pattern === 'string') {
      const path = input.path ? ` in ${input.path}` : ''
      const include = input.include ? ` (include: ${input.include})` : ''
      return `Grep "${input.pattern}"${path}${include}`
    }
    return null
  },
  createSubtasks: (input: any) => {
    if (!input || !Array.isArray(input.tasks)) return null
    const total = input.tasks.length
    return `Create ${total} subtasks`
  },
  listSubtask: () => {
    return 'List sub-agents'
  }
}

export function formatToolInput(toolName: string, input: any): string {
  // 1. Check specific formatters
  const formatter = toolInputFormatters[toolName]
  if (formatter) {
    const formatted = formatter(input)
    if (formatted) return formatted
  }

  // 2. Legacy subtask special case (pre-createSubtasks history)
  if (toolName.startsWith('create_subtask_')) {
    const agentId = toolName.replace('create_subtask_', '')
    if (input && typeof input.title === 'string') {
      const priority = input.priority ? ` (priority: ${input.priority})` : ''
      return `Subtask (${agentId}): ${input.title}${priority}`
    }
  }

  // 3. Fallback
  return formatToolPayload(input, 200)
}
