import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '../src/domain/ports/tool.js'

const jsonSchemaMock = vi.fn((schema: unknown) => ({ schema }))

vi.mock('ai', () => ({
  jsonSchema: jsonSchemaMock,
}))

describe('toolSchemaAdapter', () => {
  it('auto strategy uses Zod for simple schema and jsonSchema for complex schema', async () => {
    const { convertToolDefinitionsToAISDKTools } = await import('../src/infra/toolSchemaAdapter.js')

    jsonSchemaMock.mockClear()

    const tools: ToolDefinition[] = [
      {
        name: 'simple',
        description: 'simple',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
      {
        name: 'complex',
        description: 'complex',
        parameters: {
          type: 'object',
          properties: {
            options: {
              type: 'object',
              properties: {
                limit: { type: 'number' },
              },
            },
          },
        },
      },
    ]

    const result = convertToolDefinitionsToAISDKTools(tools, 'auto')
    expect(Object.keys(result ?? {})).toEqual(['simple', 'complex'])
    expect(jsonSchemaMock).toHaveBeenCalledTimes(1)
  })

  it('zod strategy never calls jsonSchema', async () => {
    const { convertToolDefinitionsToAISDKTools } = await import('../src/infra/toolSchemaAdapter.js')

    jsonSchemaMock.mockClear()

    const tools: ToolDefinition[] = [
      {
        name: 'complex',
        description: 'complex',
        parameters: {
          type: 'object',
          properties: {
            options: {
              type: 'object',
              properties: {
                limit: { type: 'number' },
              },
            },
          },
        },
      },
    ]

    convertToolDefinitionsToAISDKTools(tools, 'zod')
    expect(jsonSchemaMock).toHaveBeenCalledTimes(0)
  })

  it('jsonschema strategy always calls jsonSchema', async () => {
    const { convertToolDefinitionsToAISDKTools } = await import('../src/infra/toolSchemaAdapter.js')

    jsonSchemaMock.mockClear()

    const tools: ToolDefinition[] = [
      {
        name: 'simple',
        description: 'simple',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
        },
      },
      {
        name: 'complex',
        description: 'complex',
        parameters: {
          type: 'object',
          properties: {
            options: {
              type: 'object',
              properties: {
                limit: { type: 'number' },
              },
            },
          },
        },
      },
    ]

    convertToolDefinitionsToAISDKTools(tools, 'jsonschema')
    expect(jsonSchemaMock).toHaveBeenCalledTimes(2)
  })

  it('auto strategy falls back to Zod when jsonSchema throws', async () => {
    const { convertToolDefinitionsToAISDKTools } = await import('../src/infra/toolSchemaAdapter.js')

    jsonSchemaMock.mockReset()
    jsonSchemaMock.mockImplementationOnce(() => {
      throw new Error('boom')
    })

    const tools: ToolDefinition[] = [
      {
        name: 'complex',
        description: 'complex',
        parameters: {
          type: 'object',
          properties: {
            options: {
              type: 'object',
              properties: {
                limit: { type: 'number' },
              },
            },
          },
        },
      },
    ]

    const result = convertToolDefinitionsToAISDKTools(tools, 'auto')
    expect(result?.complex).toBeDefined()
    expect(jsonSchemaMock).toHaveBeenCalledTimes(1)
  })

  it('isComplexToolParameters detects nested arrays', async () => {
    const { isComplexToolParameters } = await import('../src/infra/toolSchemaAdapter.js')

    const schema: ToolDefinition['parameters'] = {
      type: 'object',
      properties: {
        values: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
      },
    }

    expect(isComplexToolParameters(schema)).toBe(true)
  })
})
