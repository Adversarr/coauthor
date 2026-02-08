/**
 * SubAgent Tool Factory
 *
 * Creates a `create_subtask_<agentId>` tool for each registered agent.
 * When invoked by an LLM:
 *   1. Creates a child task assigned to the target agent.
 *   2. Waits (blocks) until the child reaches a terminal state.
 *   3. Returns the child's outcome as a structured result.
 *
 * The tool subscribes to `EventStore.events$` for event-driven waiting
 * (no expensive projection polling). Supports AbortSignal for immediate
 * cancel/pause propagation.
 */

import type { Tool, ToolContext, ToolResult, ToolRegistry } from '../../domain/ports/tool.js'
import type { EventStore } from '../../domain/ports/eventStore.js'
import type { StoredEvent } from '../../domain/events.js'
import type { TaskService, TaskView } from '../../application/taskService.js'
import type { ConversationStore } from '../../domain/ports/conversationStore.js'
import type { RuntimeManager } from '../../agents/runtimeManager.js'

// ============================================================================
// Types
// ============================================================================

export type SubtaskToolDeps = {
  store: EventStore
  taskService: TaskService
  conversationStore: ConversationStore
  runtimeManager: RuntimeManager
  maxSubtaskDepth: number
}

export type SubtaskToolResult = {
  taskId: string
  agentId: string
  subTaskStatus: 'Success' | 'Error' | 'Cancel'
  summary?: string
  failureReason?: string
  finalAssistantMessage?: string
}

// ============================================================================
// Depth Computation
// ============================================================================

/**
 * Walk the parentTaskId chain to compute the current nesting depth.
 * Returns 0 for a root task, 1 for its direct subtask, etc.
 *
 * NOTE: Each level triggers a full `listTasks()` projection rebuild.
 * Acceptable for modest depths (≤5), but for very deep hierarchies
 * consider caching the projection or adding a depth field to TaskView.
 */
async function computeDepth(
  taskService: TaskService,
  taskId: string
): Promise<number> {
  let depth = 0
  let current: TaskView | null = await taskService.getTask(taskId)
  while (current?.parentTaskId) {
    depth++
    current = await taskService.getTask(current.parentTaskId)
  }
  return depth
}

// ============================================================================
// Extract Final Assistant Message
// ============================================================================

async function extractFinalAssistantMessage(
  conversationStore: ConversationStore,
  childTaskId: string
): Promise<string | undefined> {
  try {
    const messages = await conversationStore.getMessages(childTaskId)
    // Walk backwards to find the last assistant message with content
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && msg.content) {
        return msg.content
      }
    }
  } catch {
    // If conversation store fails, don't block the result
  }
  return undefined
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create a `create_subtask_<agentId>` tool for the given agent.
 *
 * The tool is registered as `safe` (no UIP confirmation) and blocks
 * the parent agent until the child task completes.
 */
export function createSubtaskTool(
  agentId: string,
  agentDisplayName: string,
  agentDescription: string,
  deps: SubtaskToolDeps
): Tool {
  const { store, taskService, conversationStore, runtimeManager, maxSubtaskDepth } = deps

  return {
    name: `create_subtask_${agentId}`,
    description: `Delegate a subtask to the "${agentDisplayName}" agent. ${agentDescription} Creates a child task, waits for it to complete, and returns the result.`,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title describing the subtask.'
        },
        intent: {
          type: 'string',
          description: 'Detailed instructions for the subtask agent.'
        },
        priority: {
          type: 'string',
          description: 'Task priority.',
          enum: ['foreground', 'normal', 'background']
        }
      },
      required: ['title']
    },
    riskLevel: 'safe',

    async execute(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<ToolResult> {
      const title = args.title as string
      const intent = (args.intent as string) ?? ''
      const priority = (args.priority as 'foreground' | 'normal' | 'background') ?? 'normal'

      // --- Depth check ---
      const currentDepth = await computeDepth(taskService, ctx.taskId)
      if (currentDepth >= maxSubtaskDepth) {
        return {
          toolCallId: '', // Overridden by executor
          output: JSON.stringify({
            error: `Maximum subtask nesting depth (${maxSubtaskDepth}) exceeded. Current depth: ${currentDepth}.`
          }),
          isError: true
        }
      }

      // --- Ensure RuntimeManager is running ---
      // In CLI one-shot mode, RuntimeManager may not be started.
      // We need it running so the child TaskCreated event triggers execution.
      if (!runtimeManager.isRunning) {
        runtimeManager.start()
      }

      // --- Early abort check ---
      if (ctx.signal?.aborted) {
        const result: SubtaskToolResult = {
          taskId: '',
          agentId,
          subTaskStatus: 'Cancel',
          failureReason: 'Parent task was canceled or paused'
        }
        return {
          toolCallId: '',
          output: JSON.stringify(result),
          isError: false
        }
      }

      // --- Subscribe to terminal events BEFORE creating child task ---
      // This eliminates any race between task creation and event subscription.
      // The subscription activates immediately; the childTaskId filter is set
      // once createTask() returns.
      let childTaskId = ''
      let cleanupWatcher: () => void = () => {}

      const terminalPromise = new Promise<StoredEvent>((resolve, reject) => {
        const subscription = store.events$.subscribe((event: StoredEvent) => {
          if (!childTaskId || event.streamId !== childTaskId) return

          const isTerminal =
            event.type === 'TaskCompleted' ||
            event.type === 'TaskFailed' ||
            event.type === 'TaskCanceled'

          if (isTerminal) {
            cleanup()
            resolve(event)
          }
        })

        const onAbort = () => {
          cleanup()
          reject(new DOMException('Subtask wait aborted', 'AbortError'))
        }
        ctx.signal?.addEventListener('abort', onAbort, { once: true })

        function cleanup() {
          subscription.unsubscribe()
          ctx.signal?.removeEventListener('abort', onAbort)
        }
        cleanupWatcher = cleanup
      })

      // --- Create child task (subscription already active) ---
      const createResult = await taskService.createTask({
        title,
        intent,
        priority,
        agentId,
        parentTaskId: ctx.taskId,
        authorActorId: ctx.actorId
      })
      childTaskId = createResult.taskId

      // --- Wait for terminal event ---
      try {
        const terminalEvent = await terminalPromise

        // Extract result
        const finalMessage = await extractFinalAssistantMessage(conversationStore, childTaskId)

        let result: SubtaskToolResult

        switch (terminalEvent.type) {
          case 'TaskCompleted':
            result = {
              taskId: childTaskId,
              agentId,
              subTaskStatus: 'Success',
              summary: terminalEvent.payload.summary,
              finalAssistantMessage: finalMessage
            }
            break
          case 'TaskFailed':
            result = {
              taskId: childTaskId,
              agentId,
              subTaskStatus: 'Error',
              failureReason: terminalEvent.payload.reason,
              finalAssistantMessage: finalMessage
            }
            break
          case 'TaskCanceled':
            result = {
              taskId: childTaskId,
              agentId,
              subTaskStatus: 'Cancel',
              failureReason: terminalEvent.payload.reason
            }
            break
          default:
            result = {
              taskId: childTaskId,
              agentId,
              subTaskStatus: 'Error',
              failureReason: 'Unexpected terminal event type'
            }
        }

        return {
          toolCallId: '',
          output: JSON.stringify(result),
          isError: result.subTaskStatus === 'Error'
        }
      } catch (error) {
        // AbortSignal was triggered — cascade cancel to child
        if (error instanceof DOMException && error.name === 'AbortError') {
          if (childTaskId) {
            try {
              const childTask = await taskService.getTask(childTaskId)
              if (childTask && !['done', 'failed', 'canceled'].includes(childTask.status)) {
                await taskService.cancelTask(childTaskId, 'Parent task canceled')
              }
            } catch {
              // Best-effort cancel
            }
          }

          const result: SubtaskToolResult = {
            taskId: childTaskId || '',
            agentId,
            subTaskStatus: 'Cancel',
            failureReason: 'Parent task was canceled or paused'
          }
          return {
            toolCallId: '',
            output: JSON.stringify(result),
            isError: false
          }
        }
        throw error
      } finally {
        cleanupWatcher()
      }
    }
  }
}

// ============================================================================
// Registration Helper
// ============================================================================

/**
 * Register `create_subtask_<agentId>` tools for all registered agents.
 */
export function registerSubtaskTools(
  toolRegistry: ToolRegistry,
  deps: SubtaskToolDeps
): void {
  const { runtimeManager } = deps

  for (const [agentId, agent] of runtimeManager.agents) {
    const tool = createSubtaskTool(agentId, agent.displayName, agent.description, deps)
    toolRegistry.register(tool)
  }
}
