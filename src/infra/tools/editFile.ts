/**
 * Built-in Tool: editFile
 *
 * Edits a file using string replacement (oldString -> newString).
 * Risk level: risky (requires UIP confirmation)
 */

import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
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
      const { absolutePath, currentContent } = await validateRequest(args, ctx)

      // Handle new file creation
      if (oldString === '') {
        await mkdir(dirname(absolutePath), { recursive: true })
        await writeFile(absolutePath, newString, 'utf8')
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
      await writeFile(absolutePath, newContent, 'utf8')

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
): Promise<{ absolutePath: string; currentContent?: string }> {
  const path = args.path as string
  const oldString = args.oldString as string
  const absolutePath = resolve(ctx.baseDir, path)

  // Handle new file creation check
  if (oldString === '') {
    const fileAlreadyExists = await pathExists(absolutePath)
    if (fileAlreadyExists) {
      throw new Error(`File already exists: ${path}. Use non-empty oldString to edit.`)
    }
    return { absolutePath }
  }

  // Handle existing file check
  const fileExists = await pathExists(absolutePath)
  if (!fileExists) {
    throw new Error(`File not found: ${path}`)
  }

  const currentContent = await readFile(absolutePath, 'utf8')
  
  // Check that oldString exists exactly once
  const occurrences = currentContent.split(oldString).length - 1
  if (occurrences === 0) {
    throw new Error(`oldString not found in file: ${path}`)
  }
  if (occurrences > 1) {
    throw new Error(`oldString found ${occurrences} times in file: ${path}. Must be unique.`)
  }

  return { absolutePath, currentContent }
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}
