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
  description: 'Read the content of a file. Returns the file content as text. Supports paging via offset and limit.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file from workspace root'
      },
      offset: {
        type: 'number',
        description: 'Optional: 0-based line number to start reading from. (default: 0)'
      },
      limit: {
        type: 'number',
        description: 'Optional: Maximum number of lines to read.'
      }
    },
    required: ['path']
  },
  riskLevel: 'safe',

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const path = args.path as string
    const offset = (args.offset as number) ?? 0
    const limit = args.limit as number | undefined

    try {
      // Read full file to get total count
      const content = await ctx.artifactStore.readFile(path)
      const lines = content.split('\n')
      const totalLines = lines.length

      const startIdx = Math.max(0, offset)
      let endIdx = lines.length
      if (limit !== undefined) {
        endIdx = Math.min(lines.length, startIdx + limit)
      }

      const slice = lines.slice(startIdx, endIdx)
      const isTruncated = slice.length < totalLines

      let outputContent = slice.join('\n')
      
      // If truncated or paged, add context header
      // Reference uses: "Status: Showing lines X-Y of Z total lines."
      let status = ''
      if (isTruncated || offset > 0) {
        const shownCount = slice.length
        const rangeEnd = startIdx + shownCount
        status = `Status: Showing lines ${startIdx + 1}-${rangeEnd} of ${totalLines} total lines.`
        
        // Add line numbers for clarity when paged
        const numbered = slice.map((line, i) => `${String(startIdx + i + 1).padStart(4, ' ')} | ${line}`)
        outputContent = numbered.join('\n')

        // Add hint for next page
        if (rangeEnd < totalLines) {
           status += `\nAction: To read more, use offset: ${rangeEnd}`
        }
      }

      const finalOutput = status ? `${status}\n\n${outputContent}` : outputContent

      return {
        toolCallId,
        output: { 
          content: finalOutput, 
          path, 
          lineCount: totalLines,
          linesShown: slice.length,
          offset
        },
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
