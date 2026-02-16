import { describe, it, expect } from 'vitest'
import { toolFormatters, formatToolPayload, formatToolOutput, formatToolInput } from '../src/shared/toolFormatters.js'

describe('toolFormatters.listFiles', () => {
  it('formats path + count when provided', () => {
    const output = { path: 'workspace', count: 2 }
    const formatted = toolFormatters.listFiles(output)
    expect(formatted).toBe('List workspace (2 entries)')
  })

  it('infers path from content string', () => {
    const output = {
      content: 'Directory listing for workspace:\n[DIR] tasks - 2026-02-05\nplan.md (1.2KB) - 2026-02-09',
      count: 2,
      ignored: 0
    }
    const formatted = toolFormatters.listFiles(output)
    expect(formatted).toBe('List workspace (2 entries)')
  })

  it('falls back to count when path cannot be inferred', () => {
    const output = { content: 'hello', count: 3 }
    const formatted = toolFormatters.listFiles(output)
    expect(formatted).toBe('List 3 entries')
  })
})

describe('formatToolPayload', () => {
  it('pretty prints small objects', () => {
    const value = { a: 1, b: 2 }
    const formatted = formatToolPayload(value, 200)
    expect(formatted).toContain('"a": 1')
    expect(formatted).toContain('"b": 2')
  })

  it('truncates long strings', () => {
    const long = 'x'.repeat(500)
    const formatted = formatToolPayload(long, 50)
    expect(formatted.endsWith('...(truncated)')).toBe(true)
    expect(formatted.length).toBeLessThanOrEqual(50)
  })
  it('formats editFile output', () => {
    // Legacy string output
    expect(toolFormatters.editFile('Applied replacement to file.ts')).toBe('Applied replacement to file.ts')
    
    // Object output - edited
    expect(toolFormatters.editFile({
      success: true,
      path: 'src/main.ts',
      action: 'edited',
      strategy: 'regex'
    })).toBe('Edited src/main.ts (regex)')

    // Object output - created
    expect(toolFormatters.editFile({
      success: true,
      path: 'src/new.ts',
      action: 'created'
    })).toBe('Created src/new.ts')
  })
})

describe('formatToolOutput', () => {
  it('uses custom formatter when available', () => {
    const formatted = formatToolOutput('listFiles', { path: 'docs', count: 1 })
    expect(formatted).toBe('List docs (1 entries)')
  })

  it('falls back to payload formatting', () => {
    const obj = { hello: 'world' }
    const formatted = formatToolOutput('unknownTool', obj)
    expect(formatted).toContain('"hello": "world"')
  })
})

describe('toolFormatters.grepTool', () => {
  it('formats grepTool output with actual tool format', () => {
    const output = {
      content: 'file.ts:1:foo\nfile.ts:2:bar',
      count: 2,
      strategy: 'git grep'
    }
    expect(toolFormatters.grepTool(output)).toBe('Found 2 matches')
  })
})

describe('toolFormatters.globTool', () => {
  it('formats globTool output with actual tool format', () => {
    const output = {
      matches: ['a.ts', 'b.ts'],
      count: 2,
      content: 'Found 2 files...'
    }
    expect(toolFormatters.globTool(output)).toBe('Found 2 matching files')
  })
})

describe('toolFormatters.search', () => {
  it('formats search output with new format (same as grepTool)', () => {
    const output = {
      content: 'file.ts:1:foo',
      count: 1,
      strategy: 'git grep'
    }
    expect(toolFormatters.search(output)).toBe('Found 1 matches')
  })
})

describe('toolFormatters.readFile', () => {
  it('formats readFile output with actual tool format', () => {
    const output = { path: 'src/index.ts', lineCount: 42 }
    expect(toolFormatters.readFile(output)).toBe('Read src/index.ts (42 lines)')
  })

  it('returns null for invalid output', () => {
    expect(toolFormatters.readFile({})).toBeNull()
    expect(toolFormatters.readFile(null)).toBeNull()
  })
})

describe('toolFormatters.ls', () => {
  it('formats ls output (alias for listFiles)', () => {
    // ls is an alias that expects array output
    expect(toolFormatters.ls(['file1.ts', 'file2.ts'])).toBe('List 2 entries')
  })
})

describe('toolFormatters.runCommand', () => {
  it('formats successful runCommand output', () => {
    const output = {
      stdout: 'test output',
      stderr: '',
      exitCode: 0,
      command: 'npm test'
    }
    expect(toolFormatters.runCommand(output)).toBe('Success | test output...')
  })

  it('formats failed runCommand output', () => {
    const output = {
      stdout: '',
      stderr: 'error message',
      exitCode: 1,
      command: 'npm test'
    }
    expect(toolFormatters.runCommand(output)).toBe('Exit 1 | error message...')
  })

  it('returns null for invalid output', () => {
    expect(toolFormatters.runCommand({})).toBeNull()
  })
})

describe('toolFormatters.createSubtasks', () => {
  it('formats summary output for fork-join results', () => {
    const output = {
      summary: { success: 2, error: 1, cancel: 0 },
      tasks: [{}, {}, {}]
    }
    expect(toolFormatters.createSubtasks(output)).toBe('Subtasks: 2 success, 1 error, 0 canceled')
  })
})

describe('toolFormatters.listSubtask', () => {
  it('formats listSubtask output', () => {
    const output = { total: 4 }
    expect(toolFormatters.listSubtask(output)).toBe('List 4 sub-agents')
  })
})

describe('formatToolInput', () => {
  it('formats readFile input', () => {
    expect(formatToolInput('readFile', { path: 'src/index.ts' }))
      .toBe('Read src/index.ts')
    expect(formatToolInput('readFile', { path: 'src/index.ts', offset: 10, limit: 20 }))
      .toBe('Read src/index.ts (lines 11-30)')
  })

  it('formats editFile input', () => {
    expect(formatToolInput('editFile', { path: 'src/index.ts', oldString: '', newString: 'content' }))
      .toBe('Create src/index.ts')
    expect(formatToolInput('editFile', { path: 'src/index.ts', oldString: 'old', newString: 'new' }))
      .toBe('Edit src/index.ts')
    expect(formatToolInput('editFile', { path: 'src/index.ts', oldString: 'old', newString: 'new', regex: true }))
      .toBe('Edit src/index.ts (regex)')
  })

  it('formats listFiles input', () => {
    expect(formatToolInput('listFiles', { path: '.' }))
      .toBe('List .')
    expect(formatToolInput('listFiles', { path: 'src', ignore: ['node_modules'] }))
      .toBe('List src (ignoring: node_modules)')
  })

  it('formats runCommand input', () => {
    expect(formatToolInput('runCommand', { command: 'npm test' }))
      .toBe('Run "npm test"')
    expect(formatToolInput('runCommand', { command: 'npm test', isBackground: true }))
      .toBe('Run "npm test" (background)')
  })

  it('formats globTool input', () => {
    expect(formatToolInput('globTool', { pattern: '**/*.ts' }))
      .toBe('Glob "**/*.ts"')
    expect(formatToolInput('globTool', { pattern: '**/*.ts', ignore: ['tests'] }))
      .toBe('Glob "**/*.ts" (ignoring: tests)')
  })

  it('formats grepTool input', () => {
    expect(formatToolInput('grepTool', { pattern: 'TODO' }))
      .toBe('Grep "TODO"')
    expect(formatToolInput('grepTool', { pattern: 'TODO', path: 'src' }))
      .toBe('Grep "TODO" in src')
    expect(formatToolInput('grepTool', { pattern: 'TODO', include: '*.ts' }))
      .toBe('Grep "TODO" (include: *.ts)')
  })

  it('formats createSubtasks input', () => {
    expect(formatToolInput('createSubtasks', { tasks: [{ agentId: 'coder', title: 'Implement feature' }] }))
      .toBe('Create 1 subtasks')
    expect(formatToolInput('createSubtasks', { wait: 'none', tasks: [{ agentId: 'coder', title: 'Implement feature' }, { agentId: 'reviewer', title: 'Review code' }] }))
      .toBe('Create 2 subtasks')
  })

  it('formats listSubtask input', () => {
    expect(formatToolInput('listSubtask', {}))
      .toBe('List sub-agents')
  })

  it('formats legacy create_subtask_* input for historical messages', () => {
    expect(formatToolInput('create_subtask_coder', { title: 'Implement feature' }))
      .toBe('Subtask (coder): Implement feature')
    expect(formatToolInput('create_subtask_reviewer', { title: 'Review code', priority: 'high' }))
      .toBe('Subtask (reviewer): Review code (priority: high)')
  })

  it('fallbacks to default formatting for unknown tools', () => {
    expect(formatToolInput('unknownTool', { some: 'arg' }))
      .toBe('{\n  "some": "arg"\n}')
  })
})
