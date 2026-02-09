import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { vol } from 'memfs'
import { grepTool } from '../../src/infra/tools/grepTool.js'
import { MemFsArtifactStore } from '../../src/infra/memFsArtifactStore.js'

// Mock exec
const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  exec: (...args: any[]) => mockExec(...args)
}))

describe('grepTool', () => {
  const baseDir = '/test-workspace'
  let store: MemFsArtifactStore

  beforeEach(() => {
    vi.clearAllMocks()
    vol.reset()
    store = new MemFsArtifactStore(baseDir)
    vol.mkdirSync(baseDir, { recursive: true })
  })
  
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should use git grep if available', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      if (cmd.includes('rev-parse')) {
        cb(null, 'true', '') // inside git repo
      } else if (cmd.startsWith('git grep')) {
        cb(null, 'file1.ts:1:match found', '')
      } else {
        cb(new Error('unknown command'), '', '')
      }
    })

    const result = await grepTool.execute({
      pattern: 'match'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    expect((result.output as any).strategy).toBe('git grep')
    expect((result.output as any).content).toContain('file1.ts:1:match found')
  })

  it('should fallback to system grep if git grep fails', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      if (cmd.includes('rev-parse')) {
        cb(new Error('not a git repo'), '', '')
      } else if (cmd.startsWith('grep')) {
        cb(null, 'file1.ts:1:match found', '')
      } else {
        cb(new Error('unknown command'), '', '')
      }
    })

    const result = await grepTool.execute({
      pattern: 'match'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    expect((result.output as any).strategy).toBe('system grep')
    expect((result.output as any).content).toContain('file1.ts:1:match found')
  })

  it('should fallback to JS implementation if grep fails', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      cb(new Error('command failed'), '', '')
    })

    vol.fromJSON({
      'file1.ts': 'some content\nmatch found\nend'
    }, baseDir)

    const result = await grepTool.execute({
      pattern: 'match'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    expect((result.output as any).strategy).toBe('js fallback')
    expect((result.output as any).content).toContain('file1.ts:2:match found')
  })
})
