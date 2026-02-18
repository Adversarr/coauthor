import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { runCommandTool } from '../../src/infrastructure/tools/runCommand.js'
import { EventEmitter } from 'node:events'
import { TaskService } from '../../src/application/services/taskService.js'
import { DefaultWorkspacePathResolver } from '../../src/infrastructure/workspace/workspacePathResolver.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'
import { InMemoryEventStore } from '../helpers/inMemoryEventStore.js'

// Helper: create a minimal mock ChildProcess (EventEmitter with .kill())
function mockChildProcess() {
  const cp = new EventEmitter() as any
  cp.pid = 1234
  cp.kill = vi.fn(() => { cp.emit('exit', null, 'SIGTERM') })
  cp.unref = vi.fn()
  return cp
}

// Mock child_process
const mockExec = vi.fn()
const mockSpawn = vi.fn()
const mockMkdir = vi.fn()

vi.mock('node:child_process', () => ({
  exec: (...args: any[]) => mockExec(...args),
  spawn: (...args: any[]) => mockSpawn(...args)
}))

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: any[]) => mockMkdir(...args)
}))

describe('runCommandTool', () => {
  const baseDir = '/test-workspace'

  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    // Default mock behavior for exec: success
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      const cp = mockChildProcess()
      cb(null, 'default output', '')
      queueMicrotask(() => cp.emit('exit', 0, null))
      return cp
    })
    // Default mock behavior for spawn: success
    mockSpawn.mockImplementation(() => {
      return mockChildProcess()
    })
  })
  
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should execute echo command (foreground)', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      const cp = mockChildProcess()
      // simulate echo — exec callback: (error, stdout: string, stderr: string)
      if (cmd.startsWith('echo')) {
        const output = cmd.replace('echo ', '').replace(/"/g, '')
        cb(null, output, '')
      } else {
        cb(null, '', '')
      }
      queueMicrotask(() => cp.emit('exit', 0, null))
      return cp
    })

    const result = await runCommandTool.execute({
      command: 'echo "hello world"'
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(result.isError).toBe(false)
    expect((result.output as any).stdout).toContain('hello world')
    expect((result.output as any).exitCode).toBe(0)
    expect(mockExec).toHaveBeenCalledWith('echo "hello world"', expect.objectContaining({ cwd: baseDir }), expect.any(Function))
  })

  it('should execute command in background', async () => {
    const result = await runCommandTool.execute({
      command: 'long-running-process',
      isBackground: true
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(result.isError).toBe(false)
    expect((result.output as any).pid).toBe(1234)
    expect((result.output as any).message).toContain('background')
    
    expect(mockSpawn).toHaveBeenCalled()
    // Check spawn args: shell, shellArgs, options
    // implementation uses shell wrapper
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
    expect(mockSpawn).toHaveBeenCalledWith(shell, expect.any(Array), expect.objectContaining({ detached: true, stdio: 'ignore' }))
  })

  it('should handle command failure (foreground)', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      const cp = mockChildProcess()
      // simulate failure — error has stdout/stderr as string props
      const error: any = new Error('Command failed')
      error.code = 1
      error.stdout = ''
      error.stderr = 'some error'
      cb(error, '', 'some error')
      queueMicrotask(() => cp.emit('exit', 1, null))
      return cp
    })

    const result = await runCommandTool.execute({
      command: 'exit 1'
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(result.isError).toBe(true)
    expect((result.output as any).exitCode).toBe(1)
    expect((result.output as any).stderr).toBe('some error')
  })

  it('should respect timeout (foreground)', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      const cp = mockChildProcess()
      cb(null, '', '')
      queueMicrotask(() => cp.emit('exit', 0, null))
      return cp
    })

    const result = await runCommandTool.execute({
      command: 'sleep 2',
      timeout: 100
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(mockExec).toHaveBeenCalledWith('sleep 2', expect.objectContaining({ timeout: 100 }), expect.any(Function))
  })

  it('should return error when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await runCommandTool.execute({
      command: 'echo test'
    }, { baseDir, taskId: 't1', actorId: 'a1', signal: controller.signal })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('aborted')
    expect(mockExec).not.toHaveBeenCalled()
  })

  it('uses private scoped cwd by default when workspaceResolver is provided', async () => {
    const eventStore = new InMemoryEventStore()
    const taskService = new TaskService(eventStore, DEFAULT_USER_ACTOR_ID)
    const workspaceResolver = new DefaultWorkspacePathResolver({ baseDir, taskService })
    const { taskId } = await taskService.createTask({
      title: 'Root task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    const result = await runCommandTool.execute(
      { command: 'echo scoped' },
      { baseDir, taskId, actorId: 'a1', workspaceResolver }
    )

    expect(result.isError).toBe(false)
    expect((result.output as any).cwd).toBe('private:/')
    expect(mockExec).toHaveBeenCalledWith(
      'echo scoped',
      expect.objectContaining({ cwd: `${baseDir}/private/${taskId}` }),
      expect.any(Function)
    )
    expect(mockMkdir).toHaveBeenCalledWith(
      `${baseDir}/private/${taskId}`,
      { recursive: true }
    )
  })

  it('resolves explicit public cwd when workspaceResolver is provided', async () => {
    const eventStore = new InMemoryEventStore()
    const taskService = new TaskService(eventStore, DEFAULT_USER_ACTOR_ID)
    const workspaceResolver = new DefaultWorkspacePathResolver({ baseDir, taskService })
    const { taskId } = await taskService.createTask({
      title: 'Root task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    const result = await runCommandTool.execute(
      { command: 'echo public', cwd: 'public:/docs' },
      { baseDir, taskId, actorId: 'a1', workspaceResolver }
    )

    expect(result.isError).toBe(false)
    expect((result.output as any).cwd).toBe('public:/docs')
    expect(mockExec).toHaveBeenCalledWith(
      'echo public',
      expect.objectContaining({ cwd: `${baseDir}/public/docs` }),
      expect.any(Function)
    )
    expect(mockMkdir).not.toHaveBeenCalled()
  })
})
