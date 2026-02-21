import { jsonSchema, type ToolSet } from 'ai'
import { z } from 'zod'
import type { ToolDefinition } from '../../core/ports/tool.js'

export type ToolSchemaStrategy = 'zod' | 'jsonschema' | 'auto'
export type AISDKToolSet = ToolSet
type AISDKToolEntry = AISDKToolSet[string]
type AISDKInputSchema = AISDKToolEntry['inputSchema']

export function convertToolDefinitionsToAISDKTools(
  tools: ToolDefinition[] | undefined,
  strategy: ToolSchemaStrategy = 'auto'
): AISDKToolSet | undefined {
  if (!tools || tools.length === 0) return undefined

  const result: AISDKToolSet = {}
  for (const toolDef of tools) {
    const entry: AISDKToolEntry = {
      description: toolDef.description,
      inputSchema: selectInputSchema(toolDef.parameters, strategy),
    }
    result[toolDef.name] = entry
  }
  return result
}

export function isComplexToolParameters(schema: ToolDefinition['parameters']): boolean {
  const properties = getObjectProperties(schema)
  if (!properties) {
    return true
  }

  for (const prop of Object.values(properties)) {
    if (!prop || typeof prop !== 'object') continue
    const record = prop as Record<string, unknown>

    if (record.type === 'object' && record.properties && typeof record.properties === 'object') {
      const nestedProperties = record.properties as Record<string, unknown>
      if (Object.keys(nestedProperties).length > 0) return true
    }

    if (record.type === 'array' && record.items && typeof record.items === 'object') {
      const items = record.items as Record<string, unknown>
      if (items.type === 'object' || items.type === 'array' || items.properties) return true
    }
  }
  return false
}

export function jsonSchemaToZod(schema: ToolDefinition['parameters']): z.ZodType {
  const properties = getObjectProperties(schema)
  if (!properties) {
    // Unsupported shape for handcrafted zod conversion.
    // Caller should prefer JSON schema passthrough for this case.
    return z.record(z.unknown())
  }

  const shape: Record<string, z.ZodType> = {}
  const required = getRequiredProperties(schema)

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodType

    if (!prop || typeof prop !== 'object') {
      zodType = z.unknown()
    } else {
      const record = prop as Record<string, unknown>
      const type = typeof record.type === 'string' ? record.type : 'unknown'

      switch (type) {
        case 'string':
          if (Array.isArray(record.enum) && record.enum.length > 0) {
            const enumValues = record.enum.filter((item): item is string => typeof item === 'string')
            zodType = enumValues.length > 0
              ? z.enum(enumValues as [string, ...string[]])
              : z.string()
          } else {
            zodType = z.string()
          }
          break
        case 'number':
          zodType = z.number()
          break
        case 'integer':
          zodType = z.number().int()
          break
        case 'boolean':
          zodType = z.boolean()
          break
        case 'array':
          zodType = z.array(z.unknown())
          break
        case 'object':
          zodType = z.record(z.unknown())
          break
        default:
          zodType = z.unknown()
      }

      if (typeof record.description === 'string') {
        zodType = zodType.describe(record.description)
      }
    }

    if (!required.has(key)) {
      zodType = zodType.optional()
    }

    shape[key] = zodType
  }

  return z.object(shape)
}

function selectInputSchema(schema: ToolDefinition['parameters'], strategy: ToolSchemaStrategy): AISDKInputSchema {
  if (strategy === 'jsonschema') return jsonSchema(schema)

  if (strategy === 'zod') {
    const converted = jsonSchemaToZod(schema)
    // If we failed to derive object shape, fall back to JSON schema for fidelity.
    if (converted instanceof z.ZodRecord) {
      return jsonSchema(schema)
    }
    return converted
  }

  // auto: prefer zod for simple object schemas; keep raw json schema for rich schemas
  if (isComplexToolParameters(schema)) {
    try {
      return jsonSchema(schema)
    } catch {
      return jsonSchemaToZod(schema)
    }
  }

  try {
    const converted = jsonSchemaToZod(schema)
    if (converted instanceof z.ZodRecord) {
      return jsonSchema(schema)
    }
    return converted
  } catch {
    return jsonSchema(schema)
  }
}

function getObjectProperties(
  schema: ToolDefinition['parameters']
): Record<string, unknown> | null {
  if (!schema || typeof schema !== 'object') return null
  const record = schema as Record<string, unknown>
  if (record.type !== 'object') return null
  if (!record.properties || typeof record.properties !== 'object' || Array.isArray(record.properties)) {
    return null
  }
  return record.properties as Record<string, unknown>
}

function getRequiredProperties(schema: ToolDefinition['parameters']): Set<string> {
  if (!schema || typeof schema !== 'object') return new Set<string>()
  const record = schema as Record<string, unknown>
  if (!Array.isArray(record.required)) return new Set<string>()
  return new Set(record.required.filter((item): item is string => typeof item === 'string'))
}
