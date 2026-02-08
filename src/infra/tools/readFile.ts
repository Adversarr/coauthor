/**
 * Built-in Tool: readFile
 *
 * Reads file content from the workspace.
 * Risk level: safe
 */

import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult } from '../../domain/ports/tool.js'

export const readFileTool: Tool = {
  name: 'readFile',
  description: 'Read the content of a file. Returns the file content as text.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file from workspace root'
      },
      startLine: {
        type: 'number',
        description: 'Optional: Start line number (1-based, inclusive)'
      },
      endLine: {
        type: 'number',
        description: 'Optional: End line number (1-based, inclusive)'
      }
    },
    required: ['path']
  },
  riskLevel: 'safe',

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const path = args.path as string
    const startLine = args.startLine as number | undefined
    const endLine = args.endLine as number | undefined

    try {
      // We read the full file to calculate total line count and handle slicing manually
      // This preserves the behavior of reporting total line count in the output
      const content = await ctx.artifactStore.readFile(path)

      let result: string
      if (startLine !== undefined && endLine !== undefined) {
        const lines = content.split('\n')
        const startIdx = Math.max(0, startLine - 1)
        const endIdx = Math.min(lines.length - 1, endLine - 1)
        const slice = lines.slice(startIdx, endIdx + 1)
        const numbered = slice.map((line, i) => `${String(startLine + i).padStart(4, ' ')}|${line}`)
        result = numbered.join('\n')
      } else {
        result = content
      }

      return {
        toolCallId,
        output: { content: result, path, lineCount: content.split('\n').length },
        isError: false
      }
    } catch (error) {
      return {
        toolCallId,
        output: { error: error instanceof Error ? error.message : String(error) },
        isError: true
      }
    }
  }
}
