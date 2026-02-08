import { describe, it, expect } from 'vitest'
import { buildRiskyToolDisplay, buildConfirmInteraction } from '../../src/agents/displayBuilder.js'
import type { ToolCallRequest } from '../../src/domain/ports/tool.js'

describe('DisplayBuilder', () => {
  describe('buildRiskyToolDisplay', () => {
    it('should build diff display for editFile', () => {
      const toolCall: ToolCallRequest = {
        toolCallId: '1',
        toolName: 'editFile',
        arguments: {
          path: 'file.txt',
          oldString: 'old',
          newString: 'new'
        }
      }

      const display = buildRiskyToolDisplay(toolCall)
      expect(display.contentKind).toBe('Diff')
      expect(display.content).toContain('--- file.txt')
      expect(display.content).toContain('+++ file.txt')
      expect(display.description).toContain('edit file: file.txt')
    })

    it('should build command summary for runCommand', () => {
      const toolCall: ToolCallRequest = {
        toolCallId: '1',
        toolName: 'runCommand',
        arguments: {
          command: 'ls -la',
          cwd: '/tmp'
        }
      }

      const display = buildRiskyToolDisplay(toolCall)
      expect(display.contentKind).toBe('PlainText')
      expect(display.content).toContain('Command: ls -la')
      expect(display.content).toContain('CWD: /tmp')
    })

    it('should fallback to JSON for unknown tools', () => {
      const toolCall: ToolCallRequest = {
        toolCallId: '1',
        toolName: 'unknownTool',
        arguments: { foo: 'bar' }
      }

      const display = buildRiskyToolDisplay(toolCall)
      expect(display.contentKind).toBe('Json')
      expect(display.content).toContain('"foo": "bar"')
    })
  })

  describe('buildConfirmInteraction', () => {
    it('should create interaction request', () => {
      const toolCall: ToolCallRequest = {
        toolCallId: '1',
        toolName: 'runCommand',
        arguments: { command: 'echo hi' }
      }

      const interaction = buildConfirmInteraction(toolCall)
      expect(interaction.kind).toBe('Confirm')
      expect(interaction.purpose).toBe('confirm_risky_action')
      expect(interaction.options).toHaveLength(2)
      expect(interaction.display.title).toBe('Confirm Risky Operation')
    })
  })
})
