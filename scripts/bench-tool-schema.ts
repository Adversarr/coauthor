import { performance } from 'node:perf_hooks'
import { convertToolDefinitionsToAISDKTools, type ToolSchemaStrategy } from '../src/infra/toolSchemaAdapter.js'
import type { ToolDefinition } from '../src/domain/ports/tool.js'

function buildTools(count: number): ToolDefinition[] {
  const tools: ToolDefinition[] = []
  for (let index = 0; index < count; index += 1) {
    tools.push({
      name: `tool_${index}`,
      description: `Tool ${index}`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          options: {
            type: 'object',
            properties: {
              limit: { type: 'number' },
              mode: { type: 'string', enum: ['a', 'b', 'c'] },
            },
          },
        },
        required: ['query'],
      },
    })
  }
  return tools
}

function runBench(strategy: ToolSchemaStrategy, tools: ToolDefinition[], iterations: number): number {
  const start = performance.now()
  for (let index = 0; index < iterations; index += 1) {
    convertToolDefinitionsToAISDKTools(tools, strategy)
  }
  const end = performance.now()
  return end - start
}

const toolCount = Number(process.env.BENCH_TOOL_COUNT ?? 50)
const iterations = Number(process.env.BENCH_ITERATIONS ?? 200)
const tools = buildTools(toolCount)

const strategies: ToolSchemaStrategy[] = ['zod', 'jsonschema', 'auto']
const results = strategies.map((strategy) => ({
  strategy,
  ms: runBench(strategy, tools, iterations),
}))

console.log(
  JSON.stringify(
    {
      toolCount,
      iterations,
      results,
    },
    null,
    2
  )
)

