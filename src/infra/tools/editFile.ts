/**
 * Built-in Tool: editFile
 *
 * Edits a file using string replacement (oldString -> newString).
 * Risk level: risky (requires UIP confirmation)
 */

import { dirname } from 'node:path'
import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult } from '../../domain/ports/tool.js'

export const editFileTool: Tool = {
  name: 'editFile',
  description: `Edit a file by replacing oldString with newString. For new files, use oldString="" and newString with the full content. The replacement must match exactly (including whitespace).`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file from workspace root'
      },
      oldString: {
        type: 'string',
        description: 'The exact string to replace. Use "" for creating new files.'
      },
      newString: {
        type: 'string',
        description: 'The string to replace oldString with'
      }
    },
    required: ['path', 'oldString', 'newString']
  },
  riskLevel: 'risky',

  async canExecute(args: Record<string, unknown>, ctx: ToolContext): Promise<void> {
    await validateRequest(args, ctx)
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const path = args.path as string
    const oldString = args.oldString as string
    const newString = args.newString as string

    try {
      const { currentContent } = await validateRequest(args, ctx)

      // Handle new file creation
      if (oldString === '') {
        // Ensure parent directory exists
        await ctx.artifactStore.mkdir(dirname(path))
        await ctx.artifactStore.writeFile(path, newString)
        return {
          toolCallId,
          output: { 
            success: true, 
            path, 
            action: 'created'
          },
          isError: false
        }
      }

      // Apply the replacement
      // currentContent is guaranteed to be defined if oldString !== ''
      const newContent = currentContent!.replace(oldString, newString)
      await ctx.artifactStore.writeFile(path, newContent)

      return {
        toolCallId,
        output: { 
          success: true, 
          path, 
          action: 'edited'
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

async function validateRequest(
  args: Record<string, unknown>, 
  ctx: ToolContext
): Promise<{ currentContent?: string }> {
  const path = args.path as string
  const oldString = args.oldString as string
  
  // Use ArtifactStore to check existence
  const exists = await ctx.artifactStore.exists(path)

  // Handle new file creation check
  if (oldString === '') {
    if (exists) {
      throw new Error(`File already exists: ${path}. Use non-empty oldString to edit.`)
    }
    return {}
  }

  // Handle existing file check
  if (!exists) {
    throw new Error(`File not found: ${path}`)
  }

  const currentContent = await ctx.artifactStore.readFile(path)
  
  // Check that oldString exists exactly once
  const occurrences = currentContent.split(oldString).length - 1
  if (occurrences === 0) {
    throw new Error(`oldString not found in file: ${path}`)
  }
  if (occurrences > 1) {
    throw new Error(`oldString found ${occurrences} times in file: ${path}. Must be unique.`)
  }

  return { currentContent }
}
