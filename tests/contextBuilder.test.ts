import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ContextBuilder } from '../src/application/contextBuilder.js'
import { FsArtifactStore } from '../src/infra/fsArtifactStore.js'
import type { TaskView } from '../src/application/taskService.js'
import { DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

function createTestTask(overrides: Partial<TaskView> = {}): TaskView {
  return {
    taskId: 't1',
    title: 'Test Task',
    intent: 'Do something useful',
    createdBy: DEFAULT_USER_ACTOR_ID,
    agentId: 'agent_coauthor_default',
    priority: 'foreground',
    status: 'open',
    createdAt: '2026-02-02T00:00:00Z',
    updatedAt: '2026-02-02T00:00:00Z',
    ...overrides
  }
}

describe('ContextBuilder', () => {
  test('getContextData returns correct structure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new FsArtifactStore(dir)
    const builder = new ContextBuilder(dir, store)

    const data = await builder.getContextData()

    expect(data.env.workingDirectory).toBe(dir)
    expect(data.env.platform).toBe(process.platform)
    expect(data.env.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(data.project.outline).toBeUndefined()
    expect(data.project.brief).toBeUndefined()

    rmSync(dir, { recursive: true, force: true })
  })

  test('getContextData loads project files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    writeFileSync(join(dir, 'OUTLINE.md'), '# Outline', 'utf8')
    writeFileSync(join(dir, 'STYLE.md'), '# Style', 'utf8')
    
    const store = new FsArtifactStore(dir)
    const builder = new ContextBuilder(dir, store)

    const data = await builder.getContextData()

    expect(data.project.outline).toBe('# Outline')
    expect(data.project.style).toBe('# Style')
    expect(data.project.brief).toBeUndefined()

    rmSync(dir, { recursive: true, force: true })
  })

  test('buildUserTaskContent returns task details', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new FsArtifactStore(dir)
    const builder = new ContextBuilder(dir, store)

    const task = createTestTask()

    const content = await builder.buildUserTaskContent(task)

    expect(content).toContain('# Task: Test Task')
    expect(content).toContain('Do something useful')

    rmSync(dir, { recursive: true, force: true })
  })

  test('buildUserTaskContent includes file range content when artifactRefs provided', async () => {
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

    const store = new FsArtifactStore(dir)
    const builder = new ContextBuilder(dir, store)

    const task = createTestTask({
      title: 'Improve methods section',
      intent: 'Make it more detailed',
      artifactRefs: [
        {
          kind: 'file_range',
          path: 'docs/test.tex',
          lineStart: 2,
          lineEnd: 4
        }
      ]
    })

    const userContent = await builder.buildUserTaskContent(task)

    expect(userContent).toContain('Referenced Files')
    expect(userContent).toContain('## File: docs/test.tex (L2-L4)')
    expect(userContent).toContain('Line 2: Background')
    expect(userContent).toContain('Line 3: Methods')
    expect(userContent).toContain('Line 4: Results')

    // Verify line numbers are present
    expect(userContent).toMatch(/\s+2\|Line 2: Background/)
    expect(userContent).toMatch(/\s+3\|Line 3: Methods/)
    expect(userContent).toMatch(/\s+4\|Line 4: Results/)

    rmSync(dir, { recursive: true, force: true })
  })

  test('buildUserTaskContent handles multiple artifact refs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    mkdirSync(dir, { recursive: true })

    writeFileSync(join(dir, 'file1.tex'), 'Content of file 1\nSecond line', 'utf8')
    writeFileSync(join(dir, 'file2.tex'), 'Content of file 2\nAnother line', 'utf8')

    const store = new FsArtifactStore(dir)
    const builder = new ContextBuilder(dir, store)

    const task = createTestTask({
      title: 'Cross-file refactor',
      intent: 'Align terminology',
      artifactRefs: [
        { kind: 'file_range', path: 'file1.tex', lineStart: 1, lineEnd: 2 },
        { kind: 'file_range', path: 'file2.tex', lineStart: 1, lineEnd: 2 }
      ]
    })

    const userContent = await builder.buildUserTaskContent(task)

    expect(userContent).toContain('## File: file1.tex (L1-L2)')
    expect(userContent).toContain('Content of file 1')
    expect(userContent).toContain('## File: file2.tex (L1-L2)')
    expect(userContent).toContain('Content of file 2')

    rmSync(dir, { recursive: true, force: true })
  })

  test('buildUserTaskContent skips non-file_range artifact kinds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new FsArtifactStore(dir)
    const builder = new ContextBuilder(dir, store)

    const task = createTestTask({
      title: 'Task with asset ref',
      intent: 'Test skipping non-file artifacts',
      artifactRefs: [
        { kind: 'asset', assetId: 'fig-001' }
      ]
    })

    const userContent = await builder.buildUserTaskContent(task)

    expect(userContent).toContain('Referenced Files')
    expect(userContent).toContain('## Ref: asset')
    expect(userContent).toContain('(skipped)')

    rmSync(dir, { recursive: true, force: true })
  })

  test('buildUserTaskContent works with task without artifactRefs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new FsArtifactStore(dir)
    const builder = new ContextBuilder(dir, store)

    const task = createTestTask({
      title: 'General task',
      intent: 'No specific file',
      artifactRefs: undefined
    })

    const userContent = await builder.buildUserTaskContent(task)

    expect(userContent).toContain('# Task: General task')
    expect(userContent).toContain('No specific file')
    expect(userContent).not.toContain('Referenced Files')

    rmSync(dir, { recursive: true, force: true })
  })

  test('readFileRange handles boundary cases correctly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const filePath = join(dir, 'boundary.tex')
    writeFileSync(filePath, 'L1\nL2\nL3\nL4\nL5', 'utf8')

    const store = new FsArtifactStore(dir)
    const builder = new ContextBuilder(dir, store)

    // Test first line only
    let task = createTestTask({
      title: 'First line',
      intent: '',
      artifactRefs: [{ kind: 'file_range', path: 'boundary.tex', lineStart: 1, lineEnd: 1 }]
    })
    let userContent = await builder.buildUserTaskContent(task)
    expect(userContent).toMatch(/\s+1\|L1/)
    expect(userContent).not.toContain('2|L2')

    // Test last line only
    task = createTestTask({
      artifactRefs: [{ kind: 'file_range', path: 'boundary.tex', lineStart: 5, lineEnd: 5 }]
    })
    userContent = await builder.buildUserTaskContent(task)
    expect(userContent).toMatch(/\s+5\|L5/)
    expect(userContent).not.toContain('4|L4')

    // Test out of bounds (should clamp)
    task = createTestTask({
      artifactRefs: [{ kind: 'file_range', path: 'boundary.tex', lineStart: 4, lineEnd: 100 }]
    })
    userContent = await builder.buildUserTaskContent(task)
    expect(userContent).toMatch(/\s+4\|L4/)
    expect(userContent).toMatch(/\s+5\|L5/)

    rmSync(dir, { recursive: true, force: true })
  })
})
