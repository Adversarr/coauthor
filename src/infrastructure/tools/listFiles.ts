/**
 * Built-in Tool: listFiles
 *
 * Lists files and directories in a given path.
 * Risk level: safe
 */

import { join } from 'node:path'
import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult } from '../../core/ports/tool.js'
import type { ArtifactStore } from '../../core/ports/artifactStore.js'
import { minimatch } from 'minimatch'
import { resolveToolPath } from '../workspace/toolWorkspace.js'

export const listFilesTool: Tool = {
  name: 'ListFiles',
  description: 'List files and directories in a path. Path supports private:/, shared:/, public:/ prefixes. Unscoped paths default to private:/. Returns names with [DIR] prefix, size, and modification time.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path. Supports private:/, shared:/, public:/. Unscoped paths default to private:/. Use "." for scope root.'
      },
      ignore: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: List of glob patterns to ignore'
      }
    },
    required: ['path']
  },
  riskLevel: 'safe',
  group: 'search',

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const path = args.path as string
    const ignore = (args.ignore as string[]) ?? []

    try {
      const resolvedPath = await resolveToolPath(ctx, path, { defaultScope: 'private' })
      const storePath = resolvedPath.storePath

      // Validate path exists and is directory
      const stat = await ctx.artifactStore.stat(storePath)
      if (!stat) {
        throw new Error(`Directory not found: ${resolvedPath.logicalPath}`)
      }
      if (!stat.isDirectory) {
        throw new Error(`Path is not a directory: ${resolvedPath.logicalPath}`)
      }

      const items = await ctx.artifactStore.listDir(storePath)
      
      const entries: string[] = []
      let ignoredCount = 0

      for (const item of items) {
        // Skip common ignored directories hardcoded if not specified? 
        // Better to rely on passed ignore patterns or defaults if any.
        // Let's use minimatch for ignore patterns.
        if (shouldIgnore(item, ignore)) {
          ignoredCount++
          continue
        }

        const itemPath = join(storePath, item)
        try {
          const itemStat = await ctx.artifactStore.stat(itemPath)
          if (itemStat) {
             const prefix = itemStat.isDirectory ? '[DIR] ' : ''
             const size = itemStat.isDirectory ? '' : ` (${formatSize(itemStat.size)})`
             // Format date: YYYY-MM-DD HH:MM
             const date = itemStat.mtime.toISOString().replace('T', ' ').slice(0, 16)
             entries.push(`${prefix}${item}${size} - ${date}`)
          }
        } catch {
          // Skip items we can't stat
        }
      }

      // Sort: directories first, then alphabetical
      entries.sort((a, b) => {
        const aIsDir = a.startsWith('[DIR]')
        const bIsDir = b.startsWith('[DIR]')
        if (aIsDir && !bIsDir) return -1
        if (!aIsDir && bIsDir) return 1
        return a.localeCompare(b)
      })

      const content = entries.join('\n')
      let output = `Directory listing for ${resolvedPath.logicalPath}:\n${content}`
      if (ignoredCount > 0) {
        output += `\n\n(${ignoredCount} ignored)`
      }

      return {
        toolCallId,
        output: {
          content: output,
          path: resolvedPath.logicalPath,
          count: entries.length,
          ignored: ignoredCount
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

function shouldIgnore(name: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false
  return patterns.some(pattern => minimatch(name, pattern))
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
