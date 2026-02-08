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
    const entries = (result.output as any).entries
    expect(entries).toContain('file1.txt')
    expect(entries).toContain('file2.txt')
    expect(entries).toContain('subdir/')
    expect(entries).toHaveLength(3)
  })

  it('should list files recursively', async () => {
    vol.fromJSON({
      'src/index.ts': 'content'
    }, baseDir)
    
    const result = await listFilesTool.execute({
      path: '.',
      recursive: true
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    const entries = (result.output as any).entries
    expect(entries).toContain('src/')
    expect(entries).toContain('src/index.ts')
  })

  it('should respect maxDepth', async () => {
    vol.fromJSON({
      'a/b/c/d.txt': 'content'
    }, baseDir)

    const result = await listFilesTool.execute({
      path: '.',
      recursive: true,
      maxDepth: 2
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    const entries = (result.output as any).entries
    expect(entries).toContain('a/')
    expect(entries).toContain('a/b/')
    // depth 0: ., depth 1: a/, depth 2: a/b/
    // if maxDepth is 2, it lists up to depth 1 and maybe the children of depth 1?
    // Implementation of listFilesTool handles this. 
    // Previous test said: 'a/b/c/' is depth 2 (relative to root? a is 1, b is 2, c is 3?)
    // In fs setup: a/b/c/d.txt
    // entries: a/, a/b/, a/b/c/
    
    expect(entries).toContain('a/b/c/')
    expect(entries).not.toContain('a/b/c/d.txt')
  })

  it('should filter hidden files and ignored dirs', async () => {
    vol.fromJSON({
      '.hidden': 'content',
      'node_modules/pkg.json': '{}'
    }, baseDir)

    const result = await listFilesTool.execute({
      path: '.'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    const entries = (result.output as any).entries
    expect(entries).not.toContain('.hidden')
    expect(entries).not.toContain('node_modules/')
  })

  it('should handle non-existent path', async () => {
    const result = await listFilesTool.execute({
      path: 'missing'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toBeDefined()
  })
})
