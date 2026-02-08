import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { runCommandTool } from '../../src/infra/tools/runCommand.js'

// Mock child_process
const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  exec: (cmd: string, options: any, callback: any) => mockExec(cmd, options, callback)
}))

describe('runCommandTool', () => {
  const baseDir = '/test-workspace'

  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock behavior: success
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      cb(null, { stdout: 'default output', stderr: '' })
    })
  })
  
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should execute echo command', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      // simulate echo
      if (cmd.startsWith('echo')) {
        const output = cmd.replace('echo ', '').replace(/"/g, '')
        cb(null, { stdout: output, stderr: '' })
      } else {
        cb(null, { stdout: '', stderr: '' })
      }
    })

    const result = await runCommandTool.execute({
      command: 'echo "hello world"'
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(result.isError).toBe(false)
    expect((result.output as any).stdout).toContain('hello world')
    expect((result.output as any).exitCode).toBe(0)
    expect(mockExec).toHaveBeenCalledWith('echo "hello world"', expect.objectContaining({ cwd: baseDir }), expect.any(Function))
  })

  it('should handle command failure', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      // simulate failure
      const error: any = new Error('Command failed')
      error.code = 1
      error.stdout = ''
      error.stderr = 'some error'
      cb(error, { stdout: '', stderr: 'some error' })
    })

    const result = await runCommandTool.execute({
      command: 'exit 1'
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(result.isError).toBe(true)
    expect((result.output as any).exitCode).toBe(1)
    expect((result.output as any).stderr).toBe('some error')
  })

  it('should respect timeout', async () => {
    // We verify that timeout is passed to exec options
    const result = await runCommandTool.execute({
      command: 'sleep 2',
      timeout: 100
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    // Since we mock exec, it won't actually timeout unless we simulate it or check args.
    // The real implementation relies on child_process handling timeout.
    // We can just verify arguments here.
    expect(mockExec).toHaveBeenCalledWith('sleep 2', expect.objectContaining({ timeout: 100 }), expect.any(Function))
  })
})
