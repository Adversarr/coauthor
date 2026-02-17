import { nanoid } from 'nanoid'
import type { LLMClient, LLMProfile } from '../../core/ports/llmClient.js'
import type { Tool, ToolContext, ToolResult } from '../../core/ports/tool.js'
import { executeWebFetchSubagent } from './webSubagentClient.js'

const HTTP_URL_REGEX = /https?:\/\/[^\s)\]}"'>]+/giu

function extractHttpUrls(text: string): string[] {
  return [...text.matchAll(HTTP_URL_REGEX)].map((match) => match[0])
}

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

export function createWebFetchTool(opts: {
  llm: LLMClient
  profile: LLMProfile
}): Tool {
  return {
    name: 'WebFetch',
    description: 'Fetch and summarize specific web pages using provider-native web capabilities. Prompt must include at least one http/https URL.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Fetch instruction containing at least one http/https URL',
        },
      },
      required: ['prompt'],
    },
    riskLevel: 'safe',
    group: 'search',

    async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const toolCallId = `tool_${nanoid(12)}`
      const promptRaw = args.prompt
      const prompt = typeof promptRaw === 'string' ? promptRaw.trim() : ''

      if (!prompt) {
        return errorResult(toolCallId, 'prompt must be a non-empty string')
      }

      const urls = extractHttpUrls(prompt)
      if (urls.length === 0) {
        return errorResult(toolCallId, 'prompt must include at least one http/https URL')
      }

      try {
        const result = await executeWebFetchSubagent({
          llm: opts.llm,
          profile: opts.profile,
          prompt,
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
            urls,
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
