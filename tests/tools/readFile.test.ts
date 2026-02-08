import { describe, it, expect, beforeEach } from 'vitest'
import { vol } from 'memfs'
import { readFileTool } from '../../src/infra/tools/readFile.js'
import { MemFsArtifactStore } from '../../src/infra/memFsArtifactStore.js'

describe('readFileTool', () => {
  const baseDir = '/test-workspace'
  let store: MemFsArtifactStore

  beforeEach(() => {
    vol.reset()
    store = new MemFsArtifactStore(baseDir)
    vol.mkdirSync(baseDir, { recursive: true })
  })

  it('should read full file content', async () => {
    const content = 'line1\nline2\nline3'
    vol.fromJSON({
      'test.txt': content
    }, baseDir)

    const result = await readFileTool.execute({
      path: 'test.txt'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({
      content,
      path: 'test.txt',
      lineCount: 3
    })
  })

  it('should read specific lines', async () => {
    const content = 'line1\nline2\nline3\nline4\nline5'
    vol.fromJSON({
      'test.txt': content
    }, baseDir)

    const result = await readFileTool.execute({
      path: 'test.txt',
      startLine: 2,
      endLine: 4
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    const output = (result.output as any).content
    expect(output).toContain('   2|line2')
    expect(output).toContain('   3|line3')
    expect(output).toContain('   4|line4')
    expect(output).not.toContain('line1')
    expect(output).not.toContain('line5')
  })

  it('should handle out of bounds lines', async () => {
    const content = 'line1'
    vol.fromJSON({
      'test.txt': content
    }, baseDir)

    const result = await readFileTool.execute({
      path: 'test.txt',
      startLine: 1,
      endLine: 100
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    const output = (result.output as any).content
    expect(output).toContain('   1|line1')
  })

  it('should return error for missing file', async () => {
    const result = await readFileTool.execute({
      path: 'missing.txt'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('ENOENT')
  })
})
