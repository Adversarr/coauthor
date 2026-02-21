/**
 * Tool formatters for displaying tool inputs and outputs in a human-readable format.
 * Used by TUI and potentially browser interfaces.
 */

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function getStringField(value: UnknownRecord, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' ? field : undefined
}

function getNumberField(value: UnknownRecord, key: string): number | undefined {
  const field = value[key]
  return typeof field === 'number' ? field : undefined
}

function getBooleanField(value: UnknownRecord, key: string): boolean | undefined {
  const field = value[key]
  return typeof field === 'boolean' ? field : undefined
}

function getRecordField(value: UnknownRecord, key: string): UnknownRecord | undefined {
  const field = value[key]
  return isRecord(field) ? field : undefined
}

function getStringArrayField(value: UnknownRecord, key: string): string[] | undefined {
  const field = value[key]
  if (!Array.isArray(field)) return undefined
  if (!field.every((item) => typeof item === 'string')) return undefined
  return field
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

export const toolFormatters: Record<string, (output: unknown) => string | null> = {
  readFile: (output: unknown) => {
    if (!isRecord(output)) return null
    const path = getStringField(output, 'path')
    const lineCount = getNumberField(output, 'lineCount')
    if (path && typeof lineCount === 'number') {
      return `Read ${path} (${lineCount} lines)`
    }
    return null
  },
  listFiles: (output: unknown) => {
    if (!isRecord(output)) return null
    const path = getStringField(output, 'path')
    const count = getNumberField(output, 'count')
    if (path && typeof count === 'number') {
      return `List ${path} (${count} entries)`
    }
    const content = getStringField(output, 'content')
    if (content && typeof count === 'number') {
      const match = content.match(/Directory listing for ([^:\n]+):/)
      const inferredPath = match ? match[1] : undefined
      if (inferredPath) {
        return `List ${inferredPath} (${count} entries)`
      }
      return `List ${count} entries`
    }
    return null
  },
  ls: (output: unknown) => {
    // Alias for listFiles formatter
    if (Array.isArray(output)) return `List ${output.length} entries`
    return null
  },
  globTool: (output: unknown) => {
    // Tool returns { matches: string[], count: number, content: string }
    if (!isRecord(output)) return null
    const matches = output.matches
    const count = getNumberField(output, 'count')
    if (Array.isArray(matches) && typeof count === 'number') {
      return `Found ${count} matching files`
    }
    return null
  },
  grepTool: (output: unknown) => {
    // Tool returns { content: string, count: number, strategy: string }
    if (!isRecord(output)) return null
    const content = getStringField(output, 'content')
    const count = getNumberField(output, 'count')
    if (content && typeof count === 'number') {
      return `Found ${count} matches`
    }
    return null
  },
  web_search: (output: unknown) => {
    if (!isRecord(output)) return null
    const provider = getStringField(output, 'provider')
    const query = getStringField(output, 'query')
    const content = getStringField(output, 'content')
    if (provider && query && content) {
      return `Web search (${provider}): ${query}`
    }
    return null
  },
  web_fetch: (output: unknown) => {
    if (!isRecord(output)) return null
    const provider = getStringField(output, 'provider')
    const urls = output.urls
    const content = getStringField(output, 'content')
    if (provider && Array.isArray(urls) && content) {
      return `Web fetch (${provider}): ${urls.length} URL(s)`
    }
    return null
  },
  search: (output: unknown) => {
    // Alias for grepTool - Tool returns { content: string, count: number, strategy: string }
    if (!isRecord(output)) return null
    const count = getNumberField(output, 'count')
    if (typeof count === 'number') {
      return `Found ${count} matches`
    }
    return null
  },
  runCommand: (output: unknown) => {
    if (!isRecord(output)) return null
    const exitCode = getNumberField(output, 'exitCode')
    if (typeof exitCode === 'number') {
      const status = exitCode === 0 ? 'Success' : `Exit ${exitCode}`
      const stdout = getStringField(output, 'stdout')
      const stderr = getStringField(output, 'stderr')
      const preview = stdout
        ? stdout.trim().slice(0, 50)
        : (stderr ? stderr.trim().slice(0, 50) : '')
      const suffix = preview ? ` | ${preview.replace(/\n/g, ' ')}...` : ''
      return `${status}${suffix}`
    }
    return null
  },
  editFile: (output: unknown) => {
    if (typeof output === 'string') return output
    if (!isRecord(output) || !output.success) return null
    const path = getStringField(output, 'path')
    if (typeof path !== 'string') return null
    const action = output.action === 'created' ? 'Created' : 'Edited'
    const strategyValue = getStringField(output, 'strategy')
    const strategy = strategyValue ? ` (${strategyValue})` : ''
    return `${action} ${path}${strategy}`
  },
  createSubtasks: (output: unknown) => {
    if (!isRecord(output) || !Array.isArray(output.tasks)) return null
    const total = output.tasks.length
    const summary = getRecordField(output, 'summary')
    if (summary) {
      const success = getNumberField(summary, 'success')
      const error = getNumberField(summary, 'error')
      const cancel = getNumberField(summary, 'cancel')
      if (typeof success === 'number' && typeof error === 'number' && typeof cancel === 'number') {
        return `Subtasks: ${success} success, ${error} error, ${cancel} canceled`
      }
    }
    return `Created ${total} subtasks`
  },
  listSubtask: (output: unknown) => {
    if (!isRecord(output)) return null
    const total = getNumberField(output, 'total')
    if (typeof total === 'number') {
      return `List ${total} sub-agents`
    }
    return null
  },
  activateSkill: (output: unknown) => {
    if (!isRecord(output) || !output.success) return null
    const skill = getRecordField(output, 'skill')
    if (!skill) return null
    const skillName = getStringField(skill, 'name')
    if (!skillName) return null
    const alreadyActivated = getBooleanField(output, 'alreadyActivated')
    const status = alreadyActivated ? 'already active' : 'activated'
    return `Skill ${skillName} ${status}`
  },
  TodoUpdate: (output: unknown) => {
    if (output === 'All todo complete') {
      return 'All todo complete'
    }
    if (isRecord(output)) {
      const title = getStringField(output, 'title')
      if (title) {
        return `Next todo: ${title}`
      }
    }
    return null
  },
}

export function formatToolOutput(toolName: string, output: unknown): string {
  const formatter = toolFormatters[toolName]
  const formattedCustom = formatter ? formatter(output) : null
  if (formattedCustom) {
    return formattedCustom
  }
  return formatToolPayload(output, 200)
}

export const toolInputFormatters: Record<string, (input: unknown) => string | null> = {
  readFile: (input: unknown) => {
    if (!isRecord(input)) return null
    const path = getStringField(input, 'path')
    if (path) {
      let suffix = ''
      const offset = getNumberField(input, 'offset')
      const limit = getNumberField(input, 'limit')
      if (typeof offset === 'number' && typeof limit === 'number') {
        suffix = ` (lines ${offset + 1}-${offset + limit})`
      }
      return `Read ${path}${suffix}`
    }
    return null
  },
  editFile: (input: unknown) => {
    if (!isRecord(input)) return null
    const path = getStringField(input, 'path')
    if (path) {
      const isCreate = input.oldString === ''
      if (isCreate) return `Create ${path}`
      const suffix = input.regex ? ' (regex)' : ''
      return `Edit ${path}${suffix}`
    }
    return null
  },
  listFiles: (input: unknown) => {
    if (!isRecord(input)) return null
    const path = getStringField(input, 'path')
    if (path) {
      const ignoredPaths = getStringArrayField(input, 'ignore')
      const ignore = ignoredPaths && ignoredPaths.length > 0
        ? ` (ignoring: ${ignoredPaths.join(', ')})`
        : ''
      return `List ${path}${ignore}`
    }
    return null
  },
  runCommand: (input: unknown) => {
    if (!isRecord(input)) return null
    const command = getStringField(input, 'command')
    if (command) {
      const suffix = input.isBackground ? ' (background)' : ''
      return `Run "${command}"${suffix}`
    }
    return null
  },
  globTool: (input: unknown) => {
    if (!isRecord(input)) return null
    const pattern = getStringField(input, 'pattern')
    if (pattern) {
      const ignoredPaths = getStringArrayField(input, 'ignore')
      const ignore = ignoredPaths && ignoredPaths.length > 0
        ? ` (ignoring: ${ignoredPaths.join(', ')})`
        : ''
      return `Glob "${pattern}"${ignore}`
    }
    return null
  },
  grepTool: (input: unknown) => {
    if (!isRecord(input)) return null
    const pattern = getStringField(input, 'pattern')
    if (pattern) {
      const pathValue = getStringField(input, 'path')
      const includeValue = getStringField(input, 'include')
      const path = pathValue ? ` in ${pathValue}` : ''
      const include = includeValue ? ` (include: ${includeValue})` : ''
      return `Grep "${pattern}"${path}${include}`
    }
    return null
  },
  web_search: (input: unknown) => {
    if (!isRecord(input)) return null
    const query = getStringField(input, 'query')
    if (query) {
      return `Web search "${query}"`
    }
    return null
  },
  web_fetch: (input: unknown) => {
    if (isRecord(input) && typeof getStringField(input, 'prompt') === 'string') {
      return 'Web fetch prompt'
    }
    return null
  },
  createSubtasks: (input: unknown) => {
    if (!isRecord(input) || !Array.isArray(input.tasks)) return null
    const total = input.tasks.length
    return `Create ${total} subtasks`
  },
  listSubtask: () => {
    return 'List sub-agents'
  },
  activateSkill: (input: unknown) => {
    if (!isRecord(input)) return null
    const name = getStringField(input, 'name')
    if (name) {
      return `Activate skill "${name}"`
    }
    return null
  },
  TodoUpdate: (input: unknown) => {
    if (!isRecord(input) || !Array.isArray(input.todos)) return null
    const total = input.todos.length
    const completed = input.todos.filter((todo) => {
      if (!isRecord(todo)) return false
      return todo.status === 'completed'
    }).length
    const pending = total - completed
    return `Update todos (${pending} pending, ${completed} completed)`
  }
}

export function formatToolInput(toolName: string, input: unknown): string {
  // 1. Check specific formatters
  const formatter = toolInputFormatters[toolName]
  if (formatter) {
    const formatted = formatter(input)
    if (formatted) return formatted
  }

  // 2. Legacy subtask special case (pre-createSubtasks history)
  if (toolName.startsWith('create_subtask_')) {
    const agentId = toolName.replace('create_subtask_', '')
    if (isRecord(input)) {
      const title = getStringField(input, 'title')
      if (title) {
        const priorityValue = input.priority
        const priority = priorityValue ? ` (priority: ${String(priorityValue)})` : ''
        return `Subtask (${agentId}): ${title}${priority}`
      }
    }
  }

  // 3. Fallback
  return formatToolPayload(input, 200)
}
