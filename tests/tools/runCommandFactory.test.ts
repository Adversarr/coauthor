import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createRunCommandTool } from '../../src/infra/tools/runCommand.js'
import { EventEmitter } from 'node:events'

function mockChildProcess() {
  const cp = new EventEmitter() as any
  cp.pid = 1234
  cp.kill = vi.fn()
  cp.unref = vi.fn()
  return cp
}

const mockExec = vi.fn()
const mockSpawn = vi.fn()

vi.mock('node:child_process', () => ({
  exec: (...args: any[]) => mockExec(...args),
  spawn: (...args: any[]) => mockSpawn(...args)
}))

describe('createRunCommandTool', () => {
  const baseDir = '/test-workspace'

  beforeEach(() => {
    vi.clearAllMocks()
    mockExec.mockImplementation((cmd, opts, cb) => {
      const cp = mockChildProcess()
      cb(null, 'output', '')
      return cp
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should use custom maxOutputLength', async () => {
    const customTool = createRunCommandTool({ maxOutputLength: 10 })
    
    mockExec.mockImplementation((cmd, opts, cb) => {
      const cp = mockChildProcess()
      cb(null, '123456789012345', '') // 15 chars
      return cp
    })

    const result = await customTool.execute({ command: 'echo test' }, { baseDir, taskId: 't1', actorId: 'a1' })
    
    expect((result.output as any).stdout).toContain('truncated')
    expect((result.output as any).stdout.startsWith('1234567890')).toBe(true)
  })

  it('should use custom defaultTimeout', async () => {
    const customTool = createRunCommandTool({ defaultTimeout: 500 })
    
    await customTool.execute({ command: 'sleep 1' }, { baseDir, taskId: 't1', actorId: 'a1' })
    
    expect(mockExec).toHaveBeenCalledWith('sleep 1', expect.objectContaining({ timeout: 500 }), expect.any(Function))
  })

  it('should allow overriding default timeout via arguments', async () => {
    const customTool = createRunCommandTool({ defaultTimeout: 500 })
    
    await customTool.execute({ command: 'sleep 1', timeout: 1000 }, { baseDir, taskId: 't1', actorId: 'a1' })
    
    expect(mockExec).toHaveBeenCalledWith('sleep 1', expect.objectContaining({ timeout: 1000 }), expect.any(Function))
  })
})
