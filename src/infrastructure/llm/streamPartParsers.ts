export type StreamToolCallBuffer = {
  toolName: string
  args: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

export function getStreamPartType(part: unknown): string | undefined {
  const record = asRecord(part)
  if (!record) return undefined
  return typeof record.type === 'string' ? record.type : undefined
}

export function getStreamPartText(part: unknown): string {
  const record = asRecord(part)
  if (!record) return ''
  if (typeof record.text === 'string') return record.text
  if (typeof record.delta === 'string') return record.delta
  return ''
}

export function getStreamPartId(part: unknown): string | undefined {
  const record = asRecord(part)
  if (!record) return undefined
  return typeof record.id === 'string' ? record.id : undefined
}

export function getStreamPartToolName(part: unknown): string | undefined {
  const record = asRecord(part)
  if (!record) return undefined
  return typeof record.toolName === 'string' ? record.toolName : undefined
}

export function getStreamToolCallId(part: unknown): string | undefined {
  const record = asRecord(part)
  if (!record) return undefined
  if (typeof record.toolCallId === 'string') return record.toolCallId
  if (typeof record.id === 'string') return record.id
  return undefined
}

export function getStreamPartField(part: unknown, key: string): unknown {
  const record = asRecord(part)
  if (!record) return undefined
  return record[key]
}

export function parseStreamToolInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') return input as Record<string, unknown>
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    } catch {
      return { input }
    }
  }
  return {}
}

export function isIgnoredStreamPartType(partType: string): boolean {
  return (
    partType === 'start'
    || partType === 'start-step'
    || partType === 'text-start'
    || partType === 'text-end'
    || partType === 'finish-step'
    || partType === 'stream-start'
    || partType === 'response-metadata'
    || partType === 'source'
    || partType === 'file'
    || partType === 'raw'
  )
}
