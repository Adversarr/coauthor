/**
 * Tool presentation helpers for ConversationView.
 *
 * Goals:
 * 1) Provide friendly labels/summaries for known internal tools.
 * 2) Keep all parsing resilient (never throw on malformed payloads).
 * 3) Fall back to compact generic JSON/string previews for unknown shapes.
 */

const TOOL_TITLE_MAP: Record<string, string> = {
  readFile: 'Read File',
  editFile: 'Edit File',
  listFiles: 'List Files',
  runCommand: 'Run Command',
  globTool: 'Glob Files',
  grepTool: 'Search Text',
  todoUpdate: 'Update Todos',
  TodoUpdate: 'Update Todos',
  createSubtasks: 'Create Subtasks',
  listSubtask: 'List Subtask Agents',
  web_search: 'Web Search',
  web_fetch: 'Web Fetch',
}

const INTERNAL_TOOL_NAMES = new Set(Object.keys(TOOL_TITLE_MAP))

type ParsedToolOutput = {
  parsed: unknown
  isJson: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function truncate(value: string, max = 120): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 3))}...`
}

function formatPayloadPreview(value: unknown, max = 180): string {
  if (typeof value === 'string') return truncate(value, max)
  try {
    const pretty = JSON.stringify(value, null, 2)
    if (pretty.length <= max) return pretty
    const compact = JSON.stringify(value)
    return truncate(compact, max)
  } catch {
    return truncate(String(value), max)
  }
}

function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function extractHttpUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)\]}"'>]+/giu)
  return matches ?? []
}

const HEADER_SUMMARY_MAX = 56

function truncateHeaderSummary(value: string): string {
  return truncate(value, HEADER_SUMMARY_MAX)
}

export function isInternalTool(toolName: string): boolean {
  return INTERNAL_TOOL_NAMES.has(toolName)
}

export function getToolDisplayName(toolName: string): string {
  return TOOL_TITLE_MAP[toolName] ?? humanizeToolName(toolName)
}

export function parseToolOutputContent(content: string): ParsedToolOutput {
  try {
    return { parsed: JSON.parse(content), isJson: true }
  } catch {
    return { parsed: content, isJson: false }
  }
}

export function formatToolInputSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'readFile': {
      const path = typeof input.path === 'string' ? input.path : null
      if (!path) return formatPayloadPreview(input)
      const offset = typeof input.offset === 'number' ? input.offset : undefined
      const limit = typeof input.limit === 'number' ? input.limit : undefined
      if (offset !== undefined && limit !== undefined) {
        return `${path} (lines ${offset + 1}-${offset + limit})`
      }
      return path
    }

    case 'editFile': {
      const path = typeof input.path === 'string' ? input.path : null
      if (!path) return formatPayloadPreview(input)
      const isCreate = input.oldString === ''
      const isRegex = input.regex === true
      const actionSuffix = isCreate ? ' (create)' : ''
      const regexSuffix = isRegex ? ' (regex)' : ''
      return `${path}${actionSuffix}${regexSuffix}`
    }

    case 'listFiles': {
      const path = typeof input.path === 'string' ? input.path : null
      if (!path) return formatPayloadPreview(input)
      const ignore = Array.isArray(input.ignore) ? input.ignore : []
      if (ignore.length > 0) {
        return `${path} (ignoring ${ignore.length})`
      }
      return path
    }

    case 'runCommand': {
      const command = typeof input.command === 'string' ? input.command : null
      if (!command) return formatPayloadPreview(input)
      const backgroundSuffix = input.isBackground === true ? ' (background)' : ''
      return `"${truncate(command, 80)}"${backgroundSuffix}`
    }

    case 'globTool': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : null
      if (!pattern) return formatPayloadPreview(input)
      return truncate(pattern, 120)
    }

    case 'grepTool': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : null
      if (!pattern) return formatPayloadPreview(input)
      const path = typeof input.path === 'string' ? ` @ ${input.path}` : ''
      return `"${truncate(pattern, 100)}"${path}`
    }

    case 'todoUpdate':
    case 'TodoUpdate': {
      const todos = Array.isArray(input.todos) ? input.todos : null
      if (!todos) return formatPayloadPreview(input)
      const completed = todos.filter((todo) => {
        const record = asRecord(todo)
        return record?.status === 'completed'
      }).length
      const pending = todos.length - completed
      return `${pending} pending, ${completed} completed`
    }

    case 'createSubtasks': {
      const tasks = Array.isArray(input.tasks) ? input.tasks : null
      if (!tasks) return formatPayloadPreview(input)
      return `${tasks.length} subtasks`
    }

    case 'listSubtask':
      return 'subtask agents'

    case 'web_search': {
      const query = typeof input.query === 'string' ? input.query : null
      return query ? truncate(query, 120) : formatPayloadPreview(input)
    }

    case 'web_fetch': {
      const prompt = typeof input.prompt === 'string' ? input.prompt : null
      if (!prompt) return formatPayloadPreview(input)
      const urls = extractHttpUrls(prompt)
      if (urls.length === 0) return truncate(prompt, 120)
      if (urls.length === 1) return urls[0]!
      return `${urls.length} URL(s)`
    }

    default:
      return formatPayloadPreview(input)
  }
}

/**
 * Compact header preview used by collapsed tool cards.
 * Keep it short and avoid repeating tool name (title already shows that).
 */
export function formatToolInputHeaderSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'readFile': {
      const path = typeof input.path === 'string' ? input.path : null
      if (!path) return truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
      const offset = typeof input.offset === 'number' ? input.offset : undefined
      const limit = typeof input.limit === 'number' ? input.limit : undefined
      if (offset !== undefined && limit !== undefined) {
        return truncateHeaderSummary(`${path}:${offset + 1}-${offset + limit}`)
      }
      return truncateHeaderSummary(path)
    }

    case 'editFile': {
      const path = typeof input.path === 'string' ? input.path : null
      if (!path) return truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
      const isCreate = input.oldString === ''
      const isRegex = input.regex === true
      const suffix = isCreate ? ' (create)' : isRegex ? ' (regex)' : ''
      return truncateHeaderSummary(`${path}${suffix}`)
    }

    case 'listFiles': {
      const path = typeof input.path === 'string' ? input.path : null
      return path ? truncateHeaderSummary(path) : truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
    }

    case 'runCommand': {
      const command = typeof input.command === 'string' ? input.command : null
      if (!command) return truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
      const suffix = input.isBackground === true ? ' (bg)' : ''
      return truncateHeaderSummary(`"${command}"${suffix}`)
    }

    case 'globTool': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : null
      return pattern ? truncateHeaderSummary(pattern) : truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
    }

    case 'grepTool': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : null
      const path = typeof input.path === 'string' ? input.path : null
      if (!pattern) return truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
      const suffix = path ? ` @ ${path}` : ''
      return truncateHeaderSummary(`"${pattern}"${suffix}`)
    }

    case 'todoUpdate':
    case 'TodoUpdate': {
      const todos = Array.isArray(input.todos) ? input.todos : null
      if (!todos) return truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
      const completed = todos.filter((todo) => {
        const record = asRecord(todo)
        return record?.status === 'completed'
      }).length
      const pending = todos.length - completed
      return truncateHeaderSummary(`${pending} pending, ${completed} completed`)
    }

    case 'createSubtasks': {
      const tasks = Array.isArray(input.tasks) ? input.tasks : null
      if (!tasks) return truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
      return truncateHeaderSummary(`${tasks.length} subtasks`)
    }

    case 'listSubtask':
      return 'subtask agents'

    case 'web_search': {
      const query = typeof input.query === 'string' ? input.query : null
      return query ? truncateHeaderSummary(query) : truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
    }

    case 'web_fetch': {
      const prompt = typeof input.prompt === 'string' ? input.prompt : null
      if (!prompt) return truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
      const urls = extractHttpUrls(prompt)
      if (urls.length === 0) return truncateHeaderSummary(prompt)
      if (urls.length === 1) return truncateHeaderSummary(urls[0]!)
      return `${urls.length} URLs`
    }

    default:
      return truncateHeaderSummary(formatPayloadPreview(input, HEADER_SUMMARY_MAX))
  }
}

export function formatToolOutputSummary(toolName: string, content: string): string {
  const parsed = parseToolOutputContent(content).parsed
  const record = asRecord(parsed)

  if (record && typeof record.error === 'string' && record.error.trim().length > 0) {
    return `Error: ${truncate(record.error)}`
  }

  switch (toolName) {
    case 'readFile': {
      if (record && typeof record.path === 'string' && typeof record.lineCount === 'number') {
        return `Read ${record.path} (${record.lineCount} lines)`
      }
      return formatPayloadPreview(parsed)
    }

    case 'editFile': {
      if (record && record.success === true && typeof record.path === 'string') {
        const action = record.action === 'created' ? 'Created' : 'Edited'
        const strategy = typeof record.strategy === 'string' ? ` (${record.strategy})` : ''
        return `${action} ${record.path}${strategy}`
      }
      return formatPayloadPreview(parsed)
    }

    case 'listFiles': {
      if (record && typeof record.path === 'string' && typeof record.count === 'number') {
        return `Listed ${record.path} (${record.count} entries)`
      }
      if (record && typeof record.count === 'number') {
        return `Listed ${record.count} entries`
      }
      return formatPayloadPreview(parsed)
    }

    case 'runCommand': {
      if (record && typeof record.exitCode === 'number') {
        const status = record.exitCode === 0 ? 'Success' : `Exit ${record.exitCode}`
        const preview =
          typeof record.stdout === 'string' && record.stdout.trim().length > 0
            ? record.stdout.trim().split('\n')[0]
            : typeof record.stderr === 'string' && record.stderr.trim().length > 0
              ? record.stderr.trim().split('\n')[0]
              : ''
        return preview ? `${status}: ${truncate(preview, 100)}` : status
      }
      return formatPayloadPreview(parsed)
    }

    case 'globTool': {
      if (record && typeof record.count === 'number') {
        return `Found ${record.count} matching files`
      }
      return formatPayloadPreview(parsed)
    }

    case 'grepTool': {
      if (record && typeof record.count === 'number') {
        return `Found ${record.count} matches`
      }
      return formatPayloadPreview(parsed)
    }

    case 'todoUpdate':
    case 'TodoUpdate': {
      if (typeof parsed === 'string') return truncate(parsed, 120)
      if (record && typeof record.title === 'string') return `Next todo: ${truncate(record.title, 100)}`
      return formatPayloadPreview(parsed)
    }

    case 'createSubtasks': {
      if (record) {
        const summary = asRecord(record.summary)
        if (
          summary
          && typeof summary.success === 'number'
          && typeof summary.error === 'number'
          && typeof summary.cancel === 'number'
        ) {
          return `Subtasks: ${summary.success} success, ${summary.error} error, ${summary.cancel} canceled`
        }
        if (Array.isArray(record.tasks)) {
          return `Created ${record.tasks.length} subtasks`
        }
      }
      return formatPayloadPreview(parsed)
    }

    case 'listSubtask': {
      if (record && typeof record.total === 'number') {
        return `Listed ${record.total} subtask agents`
      }
      return formatPayloadPreview(parsed)
    }

    case 'web_search': {
      if (
        record
        && typeof record.provider === 'string'
        && typeof record.query === 'string'
      ) {
        return `Web search (${record.provider}): ${truncate(record.query, 120)}`
      }
      return formatPayloadPreview(parsed)
    }

    case 'web_fetch': {
      if (
        record
        && typeof record.provider === 'string'
        && Array.isArray(record.urls)
      ) {
        return `Web fetch (${record.provider}): ${record.urls.length} URL(s)`
      }
      return formatPayloadPreview(parsed)
    }

    default:
      return formatPayloadPreview(parsed)
  }
}
