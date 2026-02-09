
import { describe, it, expect } from 'vitest'
import { formatAuditEntry } from '../../src/tui/utils.js'

describe('tui/utils', () => {
  describe('formatAuditEntry', () => {
    it('formats grepTool output correctly', () => {
      const entry: any = {
        type: 'ToolCallCompleted',
        payload: {
          toolName: 'grepTool',
          output: 'match1\nmatch2\nmatch3',
          durationMs: 100
        }
      }
      const result = formatAuditEntry(entry)
      expect(result.line).toContain('Found 3 matches')
    })

    it('formats globTool output correctly', () => {
      const entry: any = {
        type: 'ToolCallCompleted',
        payload: {
          toolName: 'globTool',
          output: ['file1', 'file2'],
          durationMs: 100
        }
      }
      const result = formatAuditEntry(entry)
      expect(result.line).toContain('Found 2 matching files')
    })

    it('formats runCommand output correctly', () => {
      const entry: any = {
        type: 'ToolCallCompleted',
        payload: {
          toolName: 'runCommand',
          output: { exitCode: 0, stdout: 'hello world' },
          durationMs: 100
        }
      }
      const result = formatAuditEntry(entry)
      expect(result.line).toContain('Success | hello world...')
    })

    it('formats runCommand failure correctly', () => {
      const entry: any = {
        type: 'ToolCallCompleted',
        payload: {
          toolName: 'runCommand',
          output: { exitCode: 1, stderr: 'error message' },
          durationMs: 100
        }
      }
      const result = formatAuditEntry(entry)
      expect(result.line).toContain('Exit 1 | error message...')
    })

    it('formats editFile output correctly', () => {
      const entry: any = {
        type: 'ToolCallCompleted',
        payload: {
          toolName: 'editFile',
          output: 'Applied replacement to file.ts',
          durationMs: 100
        }
      }
      const result = formatAuditEntry(entry)
      expect(result.line).toContain('Applied replacement to file.ts')
    })

    it('formats unknown tool output using fallback', () => {
      const entry: any = {
        type: 'ToolCallCompleted',
        payload: {
          toolName: 'unknownTool',
          output: { foo: 'bar' },
          durationMs: 100
        }
      }
      const result = formatAuditEntry(entry)
      // Should use JSON fallback
      expect(result.line).toContain('{\n  "foo": "bar"\n}')
    })
  })
})
