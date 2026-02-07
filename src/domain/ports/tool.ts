/**
 * Domain Layer - Ports
 *
 * This module defines the Tool Use port interfaces.
 * Tools are the mechanism by which Agents interact with the external world.
 */

import { z } from 'zod'
import type { ArtifactStore } from './artifactStore.js'

// ============================================================================
// Tool Call Types
// ============================================================================

export const ToolCallRequestSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.record(z.unknown())
})

export const ToolResultSchema = z.object({
  toolCallId: z.string().min(1),
  output: z.unknown(),
  isError: z.boolean()
})

export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>
export type ToolResult = z.infer<typeof ToolResultSchema>

// ============================================================================
// Tool Definition (for LLM)
// ============================================================================

export type JsonSchemaProperty = {
  type: string
  description?: string
  enum?: string[]
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

export type ToolParametersSchema = {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required?: string[]
}

export type ToolDefinition = {
  name: string
  description: string
  parameters: ToolParametersSchema
}

// ============================================================================
// Tool Risk Level
// ============================================================================

export type ToolRiskLevel = 'safe' | 'risky'

// ============================================================================
// Tool Context (for execution)
// ============================================================================

export type ToolContext = {
  taskId: string
  actorId: string
  baseDir: string
  artifactStore: ArtifactStore
  /**
   * For risky tools: the interactionId of the UIP confirmation.
   * If a risky tool is called without this, the executor should reject.
   */
  confirmedInteractionId?: string
}

// ============================================================================
// Tool Interface
// ============================================================================

/**
 * Tool interface - defines a capability that an Agent can invoke.
 *
 * Tools are registered in a ToolRegistry and executed via ToolExecutor.
 * Risky tools require user confirmation via UIP before execution.
 */
export interface Tool {
  /** Unique name for the tool */
  readonly name: string

  /** Human-readable description for LLM */
  readonly description: string

  /** JSON Schema for parameters */
  readonly parameters: ToolParametersSchema

  /** Risk level - 'risky' tools require UIP confirmation */
  readonly riskLevel: ToolRiskLevel

  /**
   * Optional pre-execution check to verify if the tool *can* be executed successfully.
   * This is called by the runtime BEFORE any risk assessment or execution.
   * 
   * Useful for:
   * - "Risky" tools to fail fast before asking for user confirmation (e.g. merge conflicts).
   * - "Safe" tools to validate preconditions without triggering execution side-effects.
   * 
   * @param args - Parsed arguments matching parameters schema
   * @param ctx - Execution context
   * @throws Error if the tool cannot be executed (e.g. preconditions failed).
   */
  canExecute?(args: Record<string, unknown>, ctx: ToolContext): Promise<void>

  /**
   * Execute the tool with given arguments.
   *
   * @param args - Parsed arguments matching parameters schema
   * @param ctx - Execution context
   * @returns Tool result (output or error)
   */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

// ============================================================================
// Tool Registry Interface
// ============================================================================

/**
 * ToolRegistry - manages available tools for Agents.
 */
export interface ToolRegistry {
  /**
   * Register a tool.
   */
  register(tool: Tool): void

  /**
   * Get a tool by name.
   */
  get(name: string): Tool | undefined

  /**
   * List all registered tools.
   */
  list(): Tool[]

  /**
   * Get tool definitions in OpenAI format for LLM calls.
   */
  toOpenAIFormat(): Array<{
    type: 'function'
    function: ToolDefinition
  }>
}

// ============================================================================
// Tool Executor Interface
// ============================================================================

/**
 * ToolExecutor - executes tools with audit logging and risk checking.
 *
 * The executor is responsible for:
 * 1. Looking up the tool in the registry
 * 2. Checking risk level - reject risky tools without confirmation
 * 3. Logging the request to AuditLog
 * 4. Executing the tool
 * 5. Logging the result to AuditLog
 * 6. Returning the result
 */
export interface ToolExecutor {
  /**
   * Execute a tool call.
   *
   * @param call - The tool call request
   * @param ctx - Execution context
   * @returns Tool result
   */
  execute(call: ToolCallRequest, ctx: ToolContext): Promise<ToolResult>
}
