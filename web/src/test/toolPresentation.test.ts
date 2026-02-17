import { describe, expect, it } from 'vitest'
import {
  formatToolInputHeaderSummary,
  formatToolInputSummary,
  formatToolOutputSummary,
  getToolDisplayName,
  isInternalTool,
  parseToolOutputContent,
} from '@/lib/toolPresentation'

describe('toolPresentation', () => {
  it('recognizes known internal tools and maps friendly titles', () => {
    expect(isInternalTool('readFile')).toBe(true)
    expect(isInternalTool('runCommand')).toBe(true)
    expect(isInternalTool('unknown_tool')).toBe(false)

    expect(getToolDisplayName('readFile')).toBe('Read File')
    expect(getToolDisplayName('unknown_tool_name')).toBe('Unknown Tool Name')
  })

  it('formats input summaries for known tools', () => {
    expect(formatToolInputSummary('readFile', { path: 'private:/README.md' })).toBe('private:/README.md')
    expect(
      formatToolInputSummary('readFile', { path: 'private:/README.md', offset: 10, limit: 5 })
    ).toBe('private:/README.md (lines 11-15)')
    expect(formatToolInputSummary('runCommand', { command: 'npm test', isBackground: true }))
      .toBe('"npm test" (background)')
    expect(
      formatToolInputSummary('web_search', { query: 'MiniMax M2.5 release date benchmark capability' })
    ).toBe('MiniMax M2.5 release date benchmark capability')
  })

  it('formats compact header summaries without repeating tool names', () => {
    expect(
      formatToolInputHeaderSummary('web_search', { query: 'Qwen 3.5 发布时间 参数规模 性能跑分 能力特性 适用场景 对比' })
    ).not.toContain('Web search')
    expect(
      formatToolInputHeaderSummary('readFile', { path: 'private:/src/features/very-long/path/index.ts' })
    ).toContain('private:/src/features/very-long/path/index.ts')
    expect(
      formatToolInputHeaderSummary('runCommand', { command: 'pnpm --filter web test -- ConversationView.test.tsx' })
    ).toContain('"pnpm --filter web test')
  })

  it('truncates compact header summary for very long inputs', () => {
    const summary = formatToolInputHeaderSummary('web_search', {
      query: 'a'.repeat(200),
    })
    expect(summary.length).toBeLessThanOrEqual(56)
    expect(summary.endsWith('...')).toBe(true)
  })

  it('formats output summaries for known successful tool payloads', () => {
    expect(
      formatToolOutputSummary('readFile', JSON.stringify({ path: 'private:/README.md', lineCount: 120 }))
    ).toBe('Read private:/README.md (120 lines)')

    expect(
      formatToolOutputSummary('listFiles', JSON.stringify({ path: 'private:/src', count: 8 }))
    ).toBe('Listed private:/src (8 entries)')

    expect(
      formatToolOutputSummary('createSubtasks', JSON.stringify({
        summary: { success: 2, error: 1, cancel: 0 },
        tasks: [{ taskId: 'a' }, { taskId: 'b' }, { taskId: 'c' }],
      }))
    ).toBe('Subtasks: 2 success, 1 error, 0 canceled')
  })

  it('formats output summaries for error payloads', () => {
    expect(formatToolOutputSummary('runCommand', JSON.stringify({ error: 'Command failed', exitCode: 1 })))
      .toBe('Error: Command failed')
  })

  it('falls back gracefully for malformed or non-json output content', () => {
    const malformed = '{"bad_json":'
    expect(formatToolOutputSummary('readFile', malformed)).toContain('{"bad_json":')

    const raw = 'plain text output from unknown tool'
    expect(formatToolOutputSummary('unknownTool', raw)).toBe(raw)
  })

  it('parses tool output content safely without throwing', () => {
    expect(parseToolOutputContent('{"ok":true}')).toEqual({ parsed: { ok: true }, isJson: true })
    expect(parseToolOutputContent('{oops')).toEqual({ parsed: '{oops', isJson: false })
  })
})
