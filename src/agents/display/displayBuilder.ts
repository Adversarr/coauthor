import { nanoid } from 'nanoid'
import { createPatch } from 'diff'
import type { InteractionDisplay } from '../../core/events/events.js'
import type { ToolCallRequest } from '../../core/ports/tool.js'
import type { AgentInteractionRequest } from '../core/agent.js'

// ============================================================================
// Display Builder - Pure functions for building UIP interaction displays
// ============================================================================

/**
 * Build a display object for a risky tool confirmation request.
 *
 * Produces tool-specific previews:
 * - `editFile` → unified diff
 * - `runCommand` → command summary
 * - fallback → JSON args preview
 */
export function buildRiskyToolDisplay(toolCall: ToolCallRequest): InteractionDisplay {
  const baseDisplay = {
    title: 'Confirm Risky Operation',
    description: `The agent wants to execute a potentially risky operation using ${toolCall.toolName}.`
  }

  if (toolCall.toolName === 'editFile') {
    const args = toolCall.arguments as Record<string, string>
    const path = args.path
    const oldString = args.oldString || ''
    const newString = args.newString || ''

    const diff = createPatch(path, oldString, newString)

    return {
      ...baseDisplay,
      description: `Agent requests to edit file: ${path}`,
      contentKind: 'Diff',
      content: diff
    }
  }

  if (toolCall.toolName === 'runCommand') {
    const args = toolCall.arguments as Record<string, unknown>
    const command = typeof args.command === 'string' ? args.command : '(unknown command)'
    const cwd = typeof args.cwd === 'string' ? args.cwd : '(workspace root)'
    const timeout = typeof args.timeout === 'number' ? args.timeout : 30000

    const content = [
      `Command: ${command}`,
      `CWD: ${cwd}`,
      `Timeout: ${timeout}ms`
    ].join('\n')

    return {
      ...baseDisplay,
      contentKind: 'PlainText',
      content
    }
  }

  // Default fallback
  const argsPreview = JSON.stringify(toolCall.arguments, null, 2)
  return {
    ...baseDisplay,
    contentKind: 'Json',
    content: argsPreview
  }
}

/**
 * Build a standard UIP confirmation request for a risky tool call.
 *
 * Used by agents to request user approval before executing risky tools.
 * Returns a complete AgentInteractionRequest with a unique ID.
 */
/**
 * Build a standard UIP confirmation request for a risky tool call.
 *
 * The display includes `metadata.toolCallId` so that the OutputHandler
 * can verify the approval is bound to the specific tool call being
 * executed, preventing confused-deputy attacks (SA-001).
 */
export function buildConfirmInteraction(toolCall: ToolCallRequest): AgentInteractionRequest {
  const display = buildRiskyToolDisplay(toolCall)
  // Bind the tool call identity into the interaction metadata (SA-001)
  display.metadata = { ...display.metadata, toolCallId: toolCall.toolCallId }

  return {
    interactionId: `ui_${nanoid(12)}`,
    kind: 'Confirm',
    purpose: 'confirm_risky_action',
    display,
    options: [
      { id: 'approve', label: 'Approve', style: 'danger' },
      { id: 'reject', label: 'Reject', style: 'default', isDefault: true }
    ]
  }
}
