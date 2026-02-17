import { nanoid } from 'nanoid'
import type { LLMClient, LLMProfile } from '../../core/ports/llmClient.js'
import type { Tool, ToolContext, ToolResult } from '../../core/ports/tool.js'
import { executeWebSearchSubagent } from './webSubagentClient.js'

function errorResult(toolCallId: string, error: string, extra?: Record<string, unknown>): ToolResult {
  return {
    toolCallId,
    output: {
      error,
      ...(extra ?? {}),
    },
    isError: true,
  }
}

export function createWebSearchTool(opts: {
  llm: LLMClient
  profile: LLMProfile
}): Tool {
  return {
    name: 'WebSearch',
    description: 'Search the web using provider-native search. Use for current events or external facts not present in local files.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query text',
        },
      },
      required: ['query'],
    },
    riskLevel: 'safe',
    group: 'search',

    async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const toolCallId = `tool_${nanoid(12)}`
      const queryRaw = args.query
      const query = typeof queryRaw === 'string' ? queryRaw.trim() : ''

      if (!query) {
        return errorResult(toolCallId, 'query must be a non-empty string')
      }

      try {
        const result = await executeWebSearchSubagent({
          llm: opts.llm,
          profile: opts.profile,
          prompt: query,
        })

        if (result.status !== 'success') {
          const errorExtras =
            result.status === 'error' && typeof result.statusCode === 'number'
              ? { statusCode: result.statusCode }
              : {}
          return errorResult(toolCallId, result.message, {
            provider: result.provider,
            status: result.status,
            ...errorExtras,
          })
        }

        return {
          toolCallId,
          output: {
            provider: result.provider,
            profile: opts.profile,
            query,
            content: result.content,
          },
          isError: false,
        }
      } catch (error) {
        return errorResult(toolCallId, error instanceof Error ? error.message : String(error), {
          provider: opts.llm.provider,
        })
      }
    },
  }
}
