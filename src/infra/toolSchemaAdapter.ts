import { jsonSchema } from 'ai'
import { z } from 'zod'
import type { ToolDefinition } from '../domain/ports/tool.js'

export type ToolSchemaStrategy = 'zod' | 'jsonschema' | 'auto'

export function convertToolDefinitionsToAISDKTools(
  tools: ToolDefinition[] | undefined,
  strategy: ToolSchemaStrategy = 'auto'
): Record<string, any> | undefined {
  if (!tools || tools.length === 0) return undefined

  const result: Record<string, any> = {}
  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      inputSchema: selectInputSchema(tool.parameters, strategy),
    }
  }
  return result
}

export function isComplexToolParameters(schema: ToolDefinition['parameters']): boolean {
  for (const prop of Object.values(schema.properties)) {
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
  const shape: Record<string, z.ZodType> = {}

  for (const [key, prop] of Object.entries(schema.properties)) {
    let zodType: z.ZodType

    switch (prop.type) {
      case 'string':
        zodType = prop.enum && prop.enum.length > 0 ? z.enum(prop.enum as [string, ...string[]]) : z.string()
        break
      case 'number':
        zodType = z.number()
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

    if (prop.description) {
      zodType = zodType.describe(prop.description)
    }

    if (!schema.required?.includes(key)) {
      zodType = zodType.optional()
    }

    shape[key] = zodType
  }

  return z.object(shape)
}

function selectInputSchema(schema: ToolDefinition['parameters'], strategy: ToolSchemaStrategy): unknown {
  if (strategy === 'zod') return jsonSchemaToZod(schema)
  if (strategy === 'jsonschema') return jsonSchema(schema as unknown as Record<string, unknown>)

  const useJsonSchema = isComplexToolParameters(schema)
  if (!useJsonSchema) return jsonSchemaToZod(schema)

  try {
    return jsonSchema(schema as unknown as Record<string, unknown>)
  } catch {
    return jsonSchemaToZod(schema)
  }
}
