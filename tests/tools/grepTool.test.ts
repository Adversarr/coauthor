import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { vol } from 'memfs'
import { grepTool } from '../../src/infrastructure/tools/grepTool.js'
import { MemFsArtifactStore } from '../../src/infrastructure/filesystem/memFsArtifactStore.js'
import { TaskService } from '../../src/application/services/taskService.js'
import { DefaultWorkspacePathResolver } from '../../src/infrastructure/workspace/workspacePathResolver.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'
import { InMemoryEventStore } from '../helpers/inMemoryEventStore.js'

// Mock execFile (B2: switched from exec to execFile for safety)
const mockExecFile = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args)
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
    mockExecFile.mockImplementation((file: string, args: string[], options: any, cb: any) => {
      if (args.includes('rev-parse')) {
        cb(null, 'true', '') // inside git repo
      } else if (file === 'git' && args[0] === 'grep') {
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
    mockExecFile.mockImplementation((file: string, args: string[], options: any, cb: any) => {
      if (file === 'git') {
        cb(new Error('not a git repo'), '', '')
      } else if (file === 'grep') {
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

  it('should fallback to JS implementation if both grep strategies fail', async () => {
    mockExecFile.mockImplementation((_file: string, _args: string[], _options: any, cb: any) => {
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

  it('should pass pattern as argument array element, not shell string (B2)', async () => {
    mockExecFile.mockImplementation((file: string, args: string[], options: any, cb: any) => {
      if (args.includes('rev-parse')) {
        cb(null, 'true', '')
      } else if (file === 'git' && args[0] === 'grep') {
        // Verify the pattern is passed as a distinct argument, not interpolated
        expect(args).toContain('match')
        expect(args.indexOf('match')).toBeGreaterThan(0)
        cb(null, 'file1.ts:1:match found', '')
      } else {
        cb(new Error('unknown command'), '', '')
      }
    })

    await grepTool.execute({
      pattern: 'match'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    // Verify execFile was called (not exec with a shell string)
    expect(mockExecFile).toHaveBeenCalled()
    // First call: git rev-parse
    const firstCall = mockExecFile.mock.calls[0]!
    expect(firstCall[0]).toBe('git')
    expect(firstCall[1]).toContain('rev-parse')
  })

  it('should reject patterns containing null bytes (B2)', async () => {
    const result = await grepTool.execute({
      pattern: 'foo\0bar'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('null bytes')
  })

  it('remaps grep output paths to scoped logical paths when resolver is present', async () => {
    const eventStore = new InMemoryEventStore()
    const taskService = new TaskService(eventStore, DEFAULT_USER_ACTOR_ID)
    const workspaceResolver = new DefaultWorkspacePathResolver({ baseDir, taskService })
    const { taskId } = await taskService.createTask({
      title: 'Root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    mockExecFile.mockImplementation((file: string, args: string[], _options: any, cb: any) => {
      if (args.includes('rev-parse')) {
        cb(null, 'true', '')
      } else if (file === 'git' && args[0] === 'grep') {
        cb(null, `private/${taskId}/file1.ts:1:match found`, '')
      } else {
        cb(new Error('unknown command'), '', '')
      }
    })

    const result = await grepTool.execute(
      { pattern: 'match' },
      { baseDir, taskId, actorId: 'a1', artifactStore: store, workspaceResolver }
    )

    expect(result.isError).toBe(false)
    expect((result.output as any).content).toContain('private:/file1.ts:1:match found')
  })
})
