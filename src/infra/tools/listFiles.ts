/**
 * Built-in Tool: listFiles
 *
 * Lists files and directories in a given path.
 * Risk level: safe
 */

import { join } from 'node:path'
import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult } from '../../domain/ports/tool.js'
import type { ArtifactStore } from '../../domain/ports/artifactStore.js'

export const listFilesTool: Tool = {
  name: 'listFiles',
  description: 'List files and directories in a given path. Returns names with / suffix for directories.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the directory from workspace root. Use "." for root.'
      },
      recursive: {
        type: 'boolean',
        description: 'Optional: If true, list files recursively (default: false)'
      },
      maxDepth: {
        type: 'number',
        description: 'Optional: Maximum depth for recursive listing (default: 3)'
      }
    },
    required: ['path']
  },
  riskLevel: 'safe',

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const path = args.path as string
    const recursive = (args.recursive as boolean) ?? false
    const maxDepth = (args.maxDepth as number) ?? 3

    try {
      const entries = await listDirectory(path, ctx.artifactStore, recursive, maxDepth, 0)

      return {
        toolCallId,
        output: { path, entries, count: entries.length },
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

async function listDirectory(
  currentPath: string,
  store: ArtifactStore,
  recursive: boolean,
  maxDepth: number,
  currentDepth: number
): Promise<string[]> {
  const entries: string[] = []
  
  // listDir returns file/directory names, not full paths
  const items = await store.listDir(currentPath)

  for (const item of items) {
    // Skip hidden files and common ignored directories
    if (item.startsWith('.') || item === 'node_modules' || item === '__pycache__') {
      continue
    }

    // Construct relative path for the item
    // Note: join handles '.' correctly (join('.', 'foo') => 'foo')
    const itemPath = join(currentPath, item)

    try {
      const itemStat = await store.stat(itemPath)
      
      if (itemStat && itemStat.isDirectory) {
        entries.push(itemPath + '/')
        if (recursive && currentDepth < maxDepth) {
          entries.push(...await listDirectory(itemPath, store, recursive, maxDepth, currentDepth + 1))
        }
      } else {
        entries.push(itemPath)
      }
    } catch {
      // Skip items we can't stat (e.g. broken symlinks or permission issues)
    }
  }

  return entries
}
