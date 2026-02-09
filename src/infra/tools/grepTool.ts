/**
 * Built-in Tool: grepTool
 *
 * Searches for text in files using regex.
 * Risk level: safe
 */

import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult } from '../../domain/ports/tool.js'
import { exec } from 'node:child_process'

function execPromise(command: string, options: { cwd: string; encoding: 'utf8' }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      } else {
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
      }
    })
  })
}

export const grepTool: Tool = {
  name: 'grepTool',
  description: 'Search for patterns in files. Uses git-grep or grep if available, falling back to JS implementation.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regular expression pattern to search for'
      },
      path: {
        type: 'string',
        description: 'Optional: Directory to search in (default: root)'
      },
      include: {
        type: 'string',
        description: 'Optional: Glob pattern for files to include (e.g. "**/*.ts")'
      }
    },
    required: ['pattern']
  },
  riskLevel: 'safe',

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const pattern = args.pattern as string
    const dirPath = (args.path as string) ?? '.'
    const include = args.include as string | undefined

    try {
      // Strategy 1: git grep
      try {
        // Check if git repo
        await execPromise('git rev-parse --is-inside-work-tree', { cwd: ctx.baseDir, encoding: 'utf8' })
        
        // Build git grep command
        const includeArgs = include ? ['--', include] : []
        const cmd = `git grep -I -n -E "${pattern.replace(/"/g, '\\"')}" ${dirPath} ${includeArgs.join(' ')}`
        
        const { stdout } = await execPromise(cmd, { cwd: ctx.baseDir, encoding: 'utf8' })
        return successResult(toolCallId, stdout, 'git grep')
      } catch (e) {
        // git grep failed or not a repo, fall through
      }

      // Strategy 2: system grep
      try {
        const includeArgs = include ? [`--include="${include}"`] : []
        const cmd = `grep -r -I -n -E "${pattern.replace(/"/g, '\\"')}" ${includeArgs.join(' ')} ${dirPath}`
        
        const { stdout } = await execPromise(cmd, { cwd: ctx.baseDir, encoding: 'utf8' })
        return successResult(toolCallId, stdout, 'system grep')
      } catch (e) {
        // grep failed, fall through
      }

      // Strategy 3: JS fallback
      const searchPattern = include ?? (dirPath === '.' ? '**/*' : `${dirPath}/**/*`)
      const files = await ctx.artifactStore.glob(searchPattern)
      
      const regex = new RegExp(pattern, 'm') // Multiline? Or per line? Grep usually reports line numbers.
      // We need to read file line by line or split.
      
      const results: string[] = []
      
      for (const file of files) {
        try {
          const content = await ctx.artifactStore.readFile(file)
          const lines = content.split('\n')
          lines.forEach((line, index) => {
            if (regex.test(line)) {
              results.push(`${file}:${index + 1}:${line}`)
            }
          })
        } catch {
          // Ignore read errors
        }
      }

      return successResult(toolCallId, results.join('\n'), 'js fallback')

    } catch (error) {
      return {
        toolCallId,
        output: { error: error instanceof Error ? error.message : String(error) },
        isError: true
      }
    }
  }
}

function successResult(toolCallId: string, content: string, strategy: string): ToolResult {
  const lines = content.trim().split('\n')
  const count = content.trim() ? lines.length : 0
  
  return {
    toolCallId,
    output: {
      content: content.trim() || 'No matches found.',
      count,
      strategy
    },
    isError: false
  }
}
