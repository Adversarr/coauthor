/**
 * Domain Layer - Ports
 *
 * This module defines the ConversationStore port interface.
 * ConversationStore persists LLM conversation history per task,
 * enabling state recovery across UIP pauses, app restarts, and crashes.
 *
 * Separation of concerns:
 * - EventStore: Collaboration & decisions (User ↔ Agent, Agent ↔ Agent)
 * - AuditLog: Tool execution details (Agent ↔ Tools/Files)
 * - ConversationStore: Agent execution context (Agent ↔ LLM)
 */

import { z } from 'zod'
import type { LLMMessage } from './llmClient.js'

// ============================================================================
// Conversation Entry Types
// ============================================================================

/**
 * Schema for validating stored LLM messages.
 * Matches the LLMMessage union type from llmClient.ts.
 */
const LLMMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.string() }),
  z.object({
    role: z.literal('assistant'),
    content: z.string().optional(),
    toolCalls: z.array(z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      arguments: z.record(z.unknown())
    })).optional(),
    reasoning: z.string().optional()
  }),
  z.object({
    role: z.literal('tool'),
    toolCallId: z.string(),
    content: z.string(),
    toolName: z.string().optional()
  })
])

/**
 * Schema for a conversation entry (message with task context).
 */
export const ConversationEntrySchema = z.object({
  taskId: z.string().min(1),
  index: z.number().int().nonnegative(),
  message: LLMMessageSchema
})

type ConversationEntry = z.infer<typeof ConversationEntrySchema>

/**
 * Stored conversation entry with persistence metadata.
 */
export type StoredConversationEntry = ConversationEntry & {
  id: number
  createdAt: string
}

// ============================================================================
// ConversationStore Interface
// ============================================================================

/**
 * ConversationStore port interface.
 *
 * Persists LLM conversation history per task for state recovery.
 * Each message is stored individually with a sequential index for ordering.
 */
export interface ConversationStore {
  /**
   * Initialize storage (create file if needed).
   */
  ensureSchema(): Promise<void>

  /**
   * Append a message to a task's conversation history.
   *
   * @param taskId - The task this message belongs to
   * @param message - The LLM message to append
   * @returns The stored entry with assigned ID and index
   */
  append(taskId: string, message: LLMMessage): Promise<StoredConversationEntry>

  /**
   * Get all messages for a task, ordered by index.
   *
   * @param taskId - The task ID
   * @returns Messages in order, or empty array if none
   */
  getMessages(taskId: string): Promise<LLMMessage[]>

  /**
   * Truncate conversation history, keeping only the last N messages.
   * Useful for managing context window limits.
   *
   * @param taskId - The task ID
   * @param keepLastN - Number of recent messages to keep
   */
  truncate(taskId: string, keepLastN: number): Promise<void>

  /**
   * Clear all messages for a task.
   * Called on task completion/failure if history is not needed.
   *
   * @param taskId - The task ID
   */
  clear(taskId: string): Promise<void>

  /**
   * Read all entries (for debugging/testing).
   *
   * @param fromIdExclusive - Start reading after this ID (0 = from beginning)
   * @returns All entries after the specified ID
   */
  readAll(fromIdExclusive?: number): Promise<StoredConversationEntry[]>
}
