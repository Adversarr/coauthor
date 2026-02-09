import { describe, it, expect, beforeEach } from 'vitest'
import { vol } from 'memfs'
import { globTool } from '../../src/infra/tools/globTool.js'
import { MemFsArtifactStore } from '../../src/infra/memFsArtifactStore.js'

describe('globTool', () => {
  const baseDir = '/test-workspace'
  let store: MemFsArtifactStore

  beforeEach(() => {
    vol.reset()
    store = new MemFsArtifactStore(baseDir)
    vol.mkdirSync(baseDir, { recursive: true })
  })

  it('should find files matching pattern', async () => {
    vol.fromJSON({
      'file1.ts': 'content',
      'file2.js': 'content',
      'src/file3.ts': 'content'
    }, baseDir)

    const result = await globTool.execute({
      pattern: '**/*.ts'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    const matches = (result.output as any).matches
    expect(matches).toContain('file1.ts')
    expect(matches).toContain('src/file3.ts')
    expect(matches).not.toContain('file2.js')
  })

  it('should support ignore patterns', async () => {
    vol.fromJSON({
      'file1.ts': 'content',
      'node_modules/file2.ts': 'content'
    }, baseDir)

    const result = await globTool.execute({
      pattern: '**/*.ts',
      ignore: ['node_modules/**']
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    const matches = (result.output as any).matches
    expect(matches).toContain('file1.ts')
    expect(matches).not.toContain('node_modules/file2.ts')
  })
})
