import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ContextBuilder } from '../src/application/contextBuilder.js'
import type { TaskView } from '../src/application/taskService.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

describe('ContextBuilder', () => {
  test('buildTaskMessages returns user message with task info', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const builder = new ContextBuilder(dir)

    const task: TaskView = {
      taskId: 't1',
      title: 'Test Task',
      intent: 'Do something useful',
      createdBy: DEFAULT_USER_ACTOR_ID,
      priority: 'foreground',
      status: 'open',
      pendingProposals: [],
      appliedProposals: [],
      createdAt: '2026-02-02T00:00:00Z',
      updatedAt: '2026-02-02T00:00:00Z'
    }

    const messages = builder.buildTaskMessages(task)

    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('user')
    expect(messages[0]?.content).toContain('Test Task')
    expect(messages[0]?.content).toContain('Do something useful')
    expect(messages[0]?.content).toContain('Output Format')

    rmSync(dir, { recursive: true, force: true })
  })

  test('buildTaskMessages includes file range content when artifactRefs provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const testDir = join(dir, 'docs')
    mkdirSync(testDir, { recursive: true })

    const filePath = join(testDir, 'test.tex')
    writeFileSync(
      filePath,
      [
        'Line 1: Introduction',
        'Line 2: Background',
        'Line 3: Methods',
        'Line 4: Results',
        'Line 5: Conclusion'
      ].join('\n'),
      'utf8'
    )

    const builder = new ContextBuilder(dir)

    const task: TaskView = {
      taskId: 't1',
      title: 'Improve methods section',
      intent: 'Make it more detailed',
      createdBy: DEFAULT_USER_ACTOR_ID,
      priority: 'foreground',
      status: 'open',
      artifactRefs: [
        {
          kind: 'file_range',
          path: 'docs/test.tex',
          lineStart: 2,
          lineEnd: 4
        }
      ],
      pendingProposals: [],
      appliedProposals: [],
      createdAt: '2026-02-02T00:00:00Z',
      updatedAt: '2026-02-02T00:00:00Z'
    }

    const messages = builder.buildTaskMessages(task)

    expect(messages).toHaveLength(1)
    const content = messages[0]?.content ?? ''
    expect(content).toContain('# Context')
    expect(content).toContain('## File: docs/test.tex (L2-L4)')
    expect(content).toContain('Line 2: Background')
    expect(content).toContain('Line 3: Methods')
    expect(content).toContain('Line 4: Results')
    expect(content).not.toContain('Line 1: Introduction')
    expect(content).not.toContain('Line 5: Conclusion')

    // Verify line numbers are present
    expect(content).toMatch(/\s+2\|Line 2: Background/)
    expect(content).toMatch(/\s+3\|Line 3: Methods/)
    expect(content).toMatch(/\s+4\|Line 4: Results/)

    rmSync(dir, { recursive: true, force: true })
  })

  test('buildTaskMessages handles multiple artifact refs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    mkdirSync(dir, { recursive: true })

    writeFileSync(join(dir, 'file1.tex'), 'Content of file 1\nSecond line', 'utf8')
    writeFileSync(join(dir, 'file2.tex'), 'Content of file 2\nAnother line', 'utf8')

    const builder = new ContextBuilder(dir)

    const task: TaskView = {
      taskId: 't1',
      title: 'Cross-file refactor',
      intent: 'Align terminology',
      createdBy: DEFAULT_USER_ACTOR_ID,
      priority: 'foreground',
      status: 'open',
      artifactRefs: [
        { kind: 'file_range', path: 'file1.tex', lineStart: 1, lineEnd: 2 },
        { kind: 'file_range', path: 'file2.tex', lineStart: 1, lineEnd: 2 }
      ],
      pendingProposals: [],
      appliedProposals: [],
      createdAt: '2026-02-02T00:00:00Z',
      updatedAt: '2026-02-02T00:00:00Z'
    }

    const messages = builder.buildTaskMessages(task)
    const content = messages[0]?.content ?? ''

    expect(content).toContain('## File: file1.tex (L1-L2)')
    expect(content).toContain('Content of file 1')
    expect(content).toContain('## File: file2.tex (L1-L2)')
    expect(content).toContain('Content of file 2')

    rmSync(dir, { recursive: true, force: true })
  })

  test('buildTaskMessages skips non-file_range artifact kinds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const builder = new ContextBuilder(dir)

    const task: TaskView = {
      taskId: 't1',
      title: 'Task with asset ref',
      intent: 'Test skipping non-file artifacts',
      createdBy: DEFAULT_USER_ACTOR_ID,
      priority: 'foreground',
      status: 'open',
      artifactRefs: [
        { kind: 'asset', assetId: 'fig-001' }
      ],
      pendingProposals: [],
      appliedProposals: [],
      createdAt: '2026-02-02T00:00:00Z',
      updatedAt: '2026-02-02T00:00:00Z'
    }

    const messages = builder.buildTaskMessages(task)
    const content = messages[0]?.content ?? ''

    expect(content).toContain('# Context')
    expect(content).toContain('## Ref: asset')
    expect(content).toContain('(skipped)')

    rmSync(dir, { recursive: true, force: true })
  })

  test('buildTaskMessages works with task without artifactRefs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const builder = new ContextBuilder(dir)

    const task: TaskView = {
      taskId: 't1',
      title: 'General task',
      intent: 'No specific file',
      createdBy: DEFAULT_USER_ACTOR_ID,
      priority: 'foreground',
      status: 'open',
      pendingProposals: [],
      appliedProposals: [],
      createdAt: '2026-02-02T00:00:00Z',
      updatedAt: '2026-02-02T00:00:00Z'
    }

    const messages = builder.buildTaskMessages(task)
    const content = messages[0]?.content ?? ''

    expect(content).toContain('# Task')
    expect(content).toContain('General task')
    expect(content).not.toContain('# Context')
    expect(content).toContain('# Output Format')

    rmSync(dir, { recursive: true, force: true })
  })

  test('readFileRange handles boundary cases correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const filePath = join(dir, 'boundary.tex')
    writeFileSync(filePath, 'L1\nL2\nL3\nL4\nL5', 'utf8')

    const builder = new ContextBuilder(dir)

    // Test first line only
    let task: TaskView = {
      taskId: 't1',
      title: 'First line',
      intent: '',
      createdBy: DEFAULT_USER_ACTOR_ID,
      priority: 'foreground',
      status: 'open',
      artifactRefs: [{ kind: 'file_range', path: 'boundary.tex', lineStart: 1, lineEnd: 1 }],
      pendingProposals: [],
      appliedProposals: [],
      createdAt: '2026-02-02T00:00:00Z',
      updatedAt: '2026-02-02T00:00:00Z'
    }
    let content = builder.buildTaskMessages(task)[0]?.content ?? ''
    expect(content).toMatch(/\s+1\|L1/)
    expect(content).not.toContain('L2')

    // Test last line only
    task = {
      ...task,
      artifactRefs: [{ kind: 'file_range', path: 'boundary.tex', lineStart: 5, lineEnd: 5 }]
    }
    content = builder.buildTaskMessages(task)[0]?.content ?? ''
    expect(content).toMatch(/\s+5\|L5/)
    expect(content).not.toContain('L4')

    // Test out of bounds (should clamp)
    task = {
      ...task,
      artifactRefs: [{ kind: 'file_range', path: 'boundary.tex', lineStart: 4, lineEnd: 100 }]
    }
    content = builder.buildTaskMessages(task)[0]?.content ?? ''
    expect(content).toMatch(/\s+4\|L4/)
    expect(content).toMatch(/\s+5\|L5/)

    rmSync(dir, { recursive: true, force: true })
  })
})
