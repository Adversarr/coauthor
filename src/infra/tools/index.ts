/**
 * Built-in Tools Index
 *
 * Re-exports all built-in tools and provides a registration function.
 */

import type { ToolRegistry } from '../../domain/ports/tool.js'
import { readFileTool } from './readFile.js'
import { editFileTool } from './editFile.js'
import { listFilesTool } from './listFiles.js'
import { runCommandTool } from './runCommand.js'
import { globTool } from './globTool.js'
import { grepTool } from './grepTool.js'

export { readFileTool } from './readFile.js'
export { editFileTool } from './editFile.js'
export { listFilesTool } from './listFiles.js'
export { runCommandTool } from './runCommand.js'
export { globTool } from './globTool.js'
export { grepTool } from './grepTool.js'
export { createSubtaskTool, registerSubtaskTools } from './createSubtaskTool.js'
export type { SubtaskToolDeps, SubtaskToolResult } from './createSubtaskTool.js'

/**
 * Register all built-in tools in the given registry.
 */
export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register(readFileTool)
  registry.register(editFileTool)
  registry.register(listFilesTool)
  registry.register(runCommandTool)
  registry.register(globTool)
  registry.register(grepTool)
}
