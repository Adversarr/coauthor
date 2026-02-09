import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vol } from 'memfs'
import { listFilesTool } from '../../src/infra/tools/listFiles.js'
import { MemFsArtifactStore } from '../../src/infra/memFsArtifactStore.js'

describe('listFilesTool', () => {
  const baseDir = '/test-workspace'
  let store: MemFsArtifactStore

  beforeEach(() => {
    vol.reset()
    store = new MemFsArtifactStore(baseDir)
    vol.mkdirSync(baseDir, { recursive: true })
  })

  it('should list files in root directory', async () => {
    vol.fromJSON({
      'file1.txt': 'content',
      'file2.txt': 'content',
      'subdir/nested': 'content'
    }, baseDir)

    const result = await listFilesTool.execute({
      path: '.'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    const output = result.output as any
    expect(output.count).toBe(3)
    expect(output.content).toContain('file1.txt')
    expect(output.content).toContain('file2.txt')
    expect(output.content).toContain('[DIR] subdir')
  })

  it('should respect ignore patterns', async () => {
    vol.fromJSON({
      'file1.txt': 'content',
      'ignore.me': 'content',
      'subdir/keep': 'content'
    }, baseDir)

    const result = await listFilesTool.execute({
      path: '.',
      ignore: ['*.me']
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    const output = result.output as any
    expect(output.count).toBe(2) // file1.txt, subdir/
    expect(output.content).toContain('file1.txt')
    expect(output.content).not.toContain('ignore.me')
    expect(output.ignored).toBe(1)
  })

  it('should handle non-existent path', async () => {
    const result = await listFilesTool.execute({
      path: 'missing'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toBeDefined()
  })
})
