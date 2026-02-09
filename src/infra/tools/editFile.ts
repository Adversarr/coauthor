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
  description: `Edit a file by replacing oldString with newString. For new files, use oldString="" and newString with the full content. The replacement must match exactly (including whitespace) unless regex is used.`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file from workspace root'
      },
      oldString: {
        type: 'string',
        description: 'The string to replace. Use "" for creating new files.'
      },
      newString: {
        type: 'string',
        description: 'The string to replace oldString with'
      },
      regex: {
        type: 'boolean',
        description: 'Optional: If true, treat oldString as a regular expression (default: false)'
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
    const isRegex = (args.regex as boolean) ?? false

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
      const { newContent, strategy } = calculateReplacement(currentContent!, oldString, newString, isRegex)
      
      await ctx.artifactStore.writeFile(path, newContent)

      return {
        toolCallId,
        output: { 
          success: true, 
          path, 
          action: 'edited',
          strategy
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
  const isRegex = (args.regex as boolean) ?? false
  
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
  
  // Validate that replacement is possible
  try {
    calculateReplacement(currentContent, oldString, 'placeholder', isRegex)
  } catch (e) {
    throw new Error(`Replacement validation failed for ${path}: ${e instanceof Error ? e.message : String(e)}`)
  }

  return { currentContent }
}

function calculateReplacement(
  content: string, 
  oldString: string, 
  newString: string, 
  isRegex: boolean
): { newContent: string; strategy: string } {
  // Strategy 1: Regex
  if (isRegex) {
    const regex = new RegExp(oldString, 'm')
    if (!regex.test(content)) {
      throw new Error('Regex pattern not found in file')
    }
    const newContent = content.replace(regex, newString)
    return { newContent, strategy: 'regex' }
  }

  // Strategy 2: Exact Match
  if (content.includes(oldString)) {
    const occurrences = content.split(oldString).length - 1
    if (occurrences > 1) {
      throw new Error(`oldString found ${occurrences} times. Please provide more context or use regex.`)
    }
    return { newContent: content.replace(oldString, newString), strategy: 'exact' }
  }

  // Strategy 3: Flexible Match
  // Tokenize by delimiters and whitespace
  // Delimiters: (){}[];:,. and quotes?
  // We want to match `function foo() {` with `function foo( ) {`
  // We insert `\s*` between tokens.
  
  const delimiters = ['\\(', '\\)', '\\{', '\\}', '\\[', '\\]', ';', ':', ',', '\\.']
  // Escape oldString first for regex chars that are NOT our delimiters?
  // Easier: split string by delimiters (keeping them) and whitespace.
  
  // 1. Escape special regex chars in oldString
  const escaped = oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  
  // 2. Split by whitespace to get tokens
  const tokens = escaped.split(/\s+/)
  
  // 3. Join with \s*
  // But this doesn't handle `foo()` matching `foo( )`. `foo()` is one token if split by space.
  // We need to split by delimiters too.
  
  // Better approach:
  // Use regex to match tokens and delimiters.
  // We want to turn `function foo() {` into `function\s*foo\s*\(\s*\)\s*\{`
  // Actually, we want `\s*` between any "word" chars and "non-word" chars?
  // Or just flexible whitespace where whitespace exists?
  // The test failure showed: `foo()` vs `foo( )`.
  // The user provided `foo()` (no space).
  // If we only replace space with `\s+`, we miss `( )`.
  // We need to insert `\s*` around delimiters.
  
  // Let's iterate over chars? No.
  // Let's replace delimiters with `\s*DELIM\s*`.
  let flexibleRegexStr = escaped
  for (const delim of delimiters) {
    // Replace delim with \s*delim\s*
    // Note: escaped string already has backslashes for delimiters if they are regex special chars (like parens).
    // e.g. `\(`
    flexibleRegexStr = flexibleRegexStr.split(delim).join(`\\s*${delim}\\s*`)
  }
  
  // Replace original whitespace with `\s+` (at least one space)
  // Wait, if we already inserted `\s*` around delimiters, `foo()` becomes `foo\s*\(\s*\)`.
  // `foo( )` matches `foo\s*\(\s*\)`.
  // What about `return true`? It has space.
  // We need to handle explicit space in oldString as `\s+`.
  
  flexibleRegexStr = flexibleRegexStr.replace(/\s+/g, '\\s+')
  
  // Clean up: `\s*\s+` -> `\s+`
  flexibleRegexStr = flexibleRegexStr.replace(/(\\s\*)+/g, '\\s*').replace(/(\\s\+)+/g, '\\s+')
  
  // Consolidate: `\s*\s+` or `\s+\s*` -> `\s+`
  flexibleRegexStr = flexibleRegexStr.replace(/\\s\*\\s\+/g, '\\s+').replace(/\\s\+\\s\*/g, '\\s+')

  const flexibleRegex = new RegExp(flexibleRegexStr, 'm')

  if (flexibleRegex.test(content)) {
    const matches = content.match(new RegExp(flexibleRegexStr, 'gm'))
    if (matches && matches.length > 1) {
      throw new Error(`oldString (flexible match) found ${matches.length} times. Please provide more context.`)
    }
    return { newContent: content.replace(flexibleRegex, newString), strategy: 'flexible' }
  }

  throw new Error('oldString not found in file (tried exact and flexible match)')
}
