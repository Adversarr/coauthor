/**
 * Built-in Tool: globTool
 *
 * Finds files matching a glob pattern.
 * Risk level: safe
 */

import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult } from '../../core/ports/tool.js'
import { posix as posixPath } from 'node:path'
import { mapStorePathToLogicalPath, resolveToolPattern } from '../workspace/toolWorkspace.js'

export const globTool: Tool = {
  name: 'GlobTool',
  description: 'Find files matching a glob pattern. Pattern supports private:/, shared:/, public:/ prefixes. Unscoped patterns default to private:/.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern. Supports private:/, shared:/, public:/. Unscoped patterns default to private:/.'
      },
      ignore: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Glob patterns to ignore'
      }
    },
    required: ['pattern']
  },
  riskLevel: 'safe',
  group: 'search',

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const pattern = args.pattern as string
    const ignore = (args.ignore as string[]) ?? []

    try {
      const resolvedPattern = await resolveToolPattern(ctx, pattern, { defaultScope: 'private' })
      const scopedIgnore = mapIgnorePatterns(ignore, resolvedPattern.scopeRootStorePath)

      // Use ArtifactStore.glob
      const matches = await ctx.artifactStore.glob(resolvedPattern.storePattern, { ignore: scopedIgnore })
      
      // Sort matches by recency if possible? 
      // Reference glob.ts sorts by mtime (newest first).
      // ArtifactStore.glob returns strings.
      // We need to stat them to sort.
      // If there are many files, stating all might be slow.
      // But for "FindFiles" it's useful.
      // Let's limit stat calls or do it in batches?
      // Or just return paths if too many?
      // Let's try to sort up to 100 files, otherwise just alphabetical.
      
      let sortedMatches = matches
      if (matches.length <= 100) {
        const withStats = await Promise.all(matches.map(async (m) => {
          try {
            const s = await ctx.artifactStore.stat(m)
            return { path: m, mtime: s?.mtime.getTime() ?? 0 }
          } catch {
            return { path: m, mtime: 0 }
          }
        }))
        
        // Sort newest first
        withStats.sort((a, b) => b.mtime - a.mtime)
        sortedMatches = withStats.map(x => x.path)
      } else {
        sortedMatches.sort()
      }

      // Format output
      // Return absolute paths or relative?
      // ArtifactStore.glob returns relative to baseDir (because glob cwd=baseDir).
      // Reference glob.ts returns absolute paths.
      // Let's return relative paths as they are shorter and context is usually workspace.
      // But tool description says "Returns absolute paths". I should probably fix description or return absolute.
      // I'll return relative paths but mention they are relative to workspace.
      
      const logicalMatches = ctx.workspaceResolver
        ? sortedMatches.map((storePath) =>
            mapStorePathToLogicalPath(
              {
                scope: resolvedPattern.scope,
                scopeRootStorePath: resolvedPattern.scopeRootStorePath
              },
              storePath
            )
          )
        : sortedMatches

      const content = logicalMatches.join('\n')
      
      return {
        toolCallId,
        output: { 
          matches: logicalMatches,
          count: logicalMatches.length,
          pattern: resolvedPattern.logicalPattern,
          content: `Found ${logicalMatches.length} files matching '${resolvedPattern.logicalPattern}':\n${content}`
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

function mapIgnorePatterns(ignore: string[], scopeRootStorePath: string): string[] {
  if (ignore.length === 0) return ignore
  if (scopeRootStorePath === '') return ignore

  return ignore.map((pattern) => {
    const trimmed = pattern.trim()
    if (trimmed === '') return trimmed
    if (/^(private|shared|public):\//u.test(trimmed)) {
      // Leave explicit scoped ignore unchanged.
      return trimmed
    }
    const normalized = trimmed.replace(/^\/+/u, '')
    return posixPath.join(scopeRootStorePath, normalized)
  })
}
