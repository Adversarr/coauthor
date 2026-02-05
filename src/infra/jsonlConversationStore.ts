/**
 * Infrastructure Layer - JSONL Conversation Store Implementation
 *
 * Stores LLM conversation history per task in a JSONL file.
 * Enables state recovery across UIP pauses, app restarts, and crashes.
 *
 * Storage format: One JSON object per line, each containing:
 * - id: Global sequential ID
 * - taskId: The task this message belongs to
 * - index: Per-task sequential index for ordering
 * - message: The LLM message (role + content/toolCalls)
 * - createdAt: ISO timestamp
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import type { LLMMessage } from '../domain/ports/llmClient.js'
import type {
  ConversationStore,
  StoredConversationEntry
} from '../domain/ports/conversationStore.js'
import { ConversationEntrySchema } from '../domain/ports/conversationStore.js'

// ============================================================================
// JSONL Row Format
// ============================================================================

type JsonlConversationRow = {
  id: number
  taskId: string
  index: number
  message: unknown
  createdAt: string
}

// ============================================================================
// Implementation
// ============================================================================

export class JsonlConversationStore implements ConversationStore {
  readonly #conversationsPath: string

  // Cache for performance
  #maxId = 0
  #taskIndices = new Map<string, number>() // taskId → current max index
  #cacheInitialized = false

  constructor(opts: { conversationsPath: string }) {
    this.#conversationsPath = opts.conversationsPath
  }

  ensureSchema(): void {
    mkdirSync(dirname(this.#conversationsPath), { recursive: true })
    if (!existsSync(this.#conversationsPath)) {
      writeFileSync(this.#conversationsPath, '')
    }
  }

  append(taskId: string, message: LLMMessage): StoredConversationEntry {
    this.#ensureCacheInitialized()

    const now = new Date().toISOString()
    this.#maxId += 1

    // Get next index for this task
    const currentIndex = this.#taskIndices.get(taskId) ?? -1
    const nextIndex = currentIndex + 1
    this.#taskIndices.set(taskId, nextIndex)

    const row: JsonlConversationRow = {
      id: this.#maxId,
      taskId,
      index: nextIndex,
      message,
      createdAt: now
    }

    appendFileSync(this.#conversationsPath, `${JSON.stringify(row)}\n`)

    return {
      id: row.id,
      taskId,
      index: nextIndex,
      message,
      createdAt: now
    }
  }

  getMessages(taskId: string): LLMMessage[] {
    const rows = this.#readRows()
    return rows
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => a.index - b.index)
      .map((r) => this.#parseMessage(r.message))
      .filter((message): message is LLMMessage => message !== null)
  }

  truncate(taskId: string, keepLastN: number): void {
    this.#ensureCacheInitialized()

    const rows = this.#readRows()
    
    // Get messages for this task, sorted by index
    const taskRows = rows
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => a.index - b.index)

    if (taskRows.length <= keepLastN) {
      return // Nothing to truncate
    }

    // Determine which rows to remove
    const rowsToRemove = new Set(
      taskRows.slice(0, taskRows.length - keepLastN).map((r) => r.id)
    )

    // Filter out removed rows and rewrite file
    const remainingRows = rows.filter((r) => !rowsToRemove.has(r.id))
    this.#rewriteFile(remainingRows)

    // Update cache
    this.#rebuildCacheFromRows(remainingRows)
  }

  clear(taskId: string): void {
    this.#ensureCacheInitialized()

    const rows = this.#readRows()
    const remainingRows = rows.filter((r) => r.taskId !== taskId)
    this.#rewriteFile(remainingRows)

    // Update cache
    this.#taskIndices.delete(taskId)
    this.#rebuildCacheFromRows(remainingRows)
  }

  readAll(fromIdExclusive = 0): StoredConversationEntry[] {
    const rows = this.#readRows()
    return rows
      .filter((r) => r.id > fromIdExclusive)
      .map((r) => this.#rowToStoredEntry(r))
      .filter((entry): entry is StoredConversationEntry => entry !== null)
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  #ensureCacheInitialized(): void {
    if (this.#cacheInitialized) return
    this.#rebuildCacheFromDisk()
  }

  #rebuildCacheFromDisk(): void {
    const rows = this.#readRows()
    this.#rebuildCacheFromRows(rows)
  }

  #rebuildCacheFromRows(rows: JsonlConversationRow[]): void {
    this.#maxId = rows.length > 0 ? Math.max(...rows.map((r) => r.id)) : 0
    
    // Rebuild task indices
    this.#taskIndices.clear()
    for (const row of rows) {
      const currentMax = this.#taskIndices.get(row.taskId) ?? -1
      if (row.index > currentMax) {
        this.#taskIndices.set(row.taskId, row.index)
      }
    }

    this.#cacheInitialized = true
  }

  #readRows(): JsonlConversationRow[] {
    if (!existsSync(this.#conversationsPath)) return []
    const raw = readFileSync(this.#conversationsPath, 'utf8')
    const lines = raw.split('\n').filter((line) => line.trim())
    const rows: JsonlConversationRow[] = []
    for (const line of lines) {
      try {
        rows.push(JSON.parse(line) as JsonlConversationRow)
      } catch {
        continue
      }
    }
    return rows
  }

  #rewriteFile(rows: JsonlConversationRow[]): void {
    const content = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '')
    writeFileSync(this.#conversationsPath, content)
  }

  #parseMessage(raw: unknown): LLMMessage | null {
    const parsed = ConversationEntrySchema.pick({ message: true }).safeParse({ message: raw })
    if (!parsed.success) return null
    return parsed.data.message as LLMMessage
  }

  #rowToStoredEntry(row: JsonlConversationRow): StoredConversationEntry | null {
    const message = this.#parseMessage(row.message)
    if (!message) return null
    return {
      id: row.id,
      taskId: row.taskId,
      index: row.index,
      message,
      createdAt: row.createdAt
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createConversationStore(conversationsPath: string): ConversationStore {
  const store = new JsonlConversationStore({ conversationsPath })
  store.ensureSchema()
  return store
}
