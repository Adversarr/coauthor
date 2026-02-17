/**
 * Built-in Tool: runCommand
 *
 * Executes a shell command in the workspace.
 * Risk level: risky (requires UIP confirmation)
 *
 * **Cancellation contract (PR-001)**: Supports AbortSignal via
 * ctx.signal. When aborted, the child process is killed (SIGTERM)
 * and the tool returns an error result indicating cancellation.
 */

import { exec, spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import type { Tool, ToolContext, ToolResult } from '../../core/ports/tool.js'
import { nanoid } from 'nanoid'
import { resolveToolPath } from '../workspace/toolWorkspace.js'

const DEFAULT_MAX_OUTPUT_LENGTH = 10000
const DEFAULT_TIMEOUT = 30000

// ============================================================================
// Background Process Tracker
// ============================================================================

/**
 * Tracks background processes spawned by runCommand.
 * Allows termination on task cancel or server shutdown.
 */
export class ProcessTracker {
  readonly #processes = new Map<number, { child: ChildProcess; taskId: string; command: string }>()

  /** Track a spawned background process. */
  track(pid: number, child: ChildProcess, taskId: string, command: string): void {
    this.#processes.set(pid, { child, taskId, command })
    child.on('exit', () => { this.#processes.delete(pid) })
  }

  /** Kill all tracked processes for a given task. */
  killByTask(taskId: string): void {
    for (const [pid, info] of this.#processes) {
      if (info.taskId === taskId) {
        try { info.child.kill('SIGTERM') } catch { /* already dead */ }
        this.#processes.delete(pid)
      }
    }
  }

  /** Kill a specific process by PID. */
  kill(pid: number): boolean {
    const info = this.#processes.get(pid)
    if (!info) return false
    try { info.child.kill('SIGTERM') } catch { /* already dead */ }
    this.#processes.delete(pid)
    return true
  }

  /** Kill all tracked processes (e.g. on server shutdown). */
  killAll(): void {
    for (const [pid, info] of this.#processes) {
      try { info.child.kill('SIGTERM') } catch { /* already dead */ }
      this.#processes.delete(pid)
    }
  }

  /** Number of currently tracked processes. */
  get size(): number { return this.#processes.size }

  /** List all tracked process PIDs with their task IDs. */
  list(): Array<{ pid: number; taskId: string; command: string }> {
    return [...this.#processes.entries()].map(([pid, info]) => ({
      pid,
      taskId: info.taskId,
      command: info.command,
    }))
  }
}

/** Global process tracker instance. */
export const processTracker = new ProcessTracker()

export function createRunCommandTool(opts?: { maxOutputLength?: number; defaultTimeout?: number }): Tool {
  const maxOutputLength = opts?.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH
  const defaultTimeout = opts?.defaultTimeout ?? DEFAULT_TIMEOUT

  return {
    name: 'RunCommand',
    description: 'Execute a shell command in a scoped workspace directory. By default runs in private:/ for the current task. Supports cwd with private:/, shared:/, public:/ prefixes.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute'
        },
        timeout: {
          type: 'number',
          description: `Optional: Timeout in milliseconds (default: ${defaultTimeout})`
        },
        cwd: {
          type: 'string',
          description: 'Optional: Working directory path. Supports private:/, shared:/, public:/ prefixes. Default: private:/'
        },
        isBackground: {
          type: 'boolean',
          description: 'Optional: If true, run command in background and return PID immediately (default: false)'
        }
      },
      required: ['command']
    },
    riskLevel: 'risky',
    group: 'exec',

    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const toolCallId = `tool_${nanoid(12)}`
      const command = args.command as string
      const timeout = (args.timeout as number) ?? defaultTimeout
      const cwdArg = args.cwd as string | undefined
      const isBackground = (args.isBackground as boolean) ?? false
      const defaultCwd = ctx.workspaceResolver ? 'private:/' : '.'
      let resolvedCwdLogical = cwdArg ?? defaultCwd

      // Early abort check (PR-001)
      if (ctx.signal?.aborted) {
        return {
          toolCallId,
          output: { error: 'Command execution aborted: task was canceled or paused', command },
          isError: true
        }
      }

      try {
        const resolvedCwd = await resolveToolPath(ctx, cwdArg ?? defaultCwd, { defaultScope: 'private' })
        resolvedCwdLogical = resolvedCwd.logicalPath
        // Private/shared workspaces are created lazily when first used.
        if (resolvedCwd.scope !== 'public') {
          await mkdir(resolvedCwd.absolutePath, { recursive: true })
        }

        if (isBackground) {
          // Run in background using spawn — tracked for cleanup
          const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
          const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command]
          
          const child = spawn(shell, shellArgs, {
            cwd: resolvedCwd.absolutePath,
            detached: true,
            stdio: 'ignore',
          })

          if (child.pid != null) {
            processTracker.track(child.pid, child, ctx.taskId, command)
          }

          // Listen for abort to kill background process
          if (ctx.signal && child.pid != null) {
            const pid = child.pid
            const onAbort = () => { processTracker.kill(pid) }
            ctx.signal.addEventListener('abort', onAbort, { once: true })
            child.on('exit', () => { ctx.signal?.removeEventListener('abort', onAbort) })
          }

          child.unref()

          return {
            toolCallId,
            output: {
              pid: child.pid,
              command,
              cwd: resolvedCwd.logicalPath,
              message: 'Command started in background'
            },
            isError: false
          }
        }

        // Foreground execution using exec
        const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          const child: ChildProcess = exec(command, {
            cwd: resolvedCwd.absolutePath,
            timeout,
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
          }, (error, stdout, stderr) => {
            if (error) {
              reject(Object.assign(error, {
                stdout: stdout ?? '',
                stderr: stderr ?? ''
              }))
            } else {
              resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
            }
          })

          // Kill child process on abort (PR-001)
          const onAbort = () => {
            child.kill('SIGTERM')
            reject(new DOMException('Command aborted', 'AbortError'))
          }
          ctx.signal?.addEventListener('abort', onAbort, { once: true })

          child.on('exit', () => {
            ctx.signal?.removeEventListener('abort', onAbort)
          })
        })

        const truncatedStdout =
          result.stdout.length > maxOutputLength
            ? result.stdout.slice(0, maxOutputLength) + '\n... (output truncated)'
            : result.stdout

        const truncatedStderr =
          result.stderr.length > maxOutputLength
            ? result.stderr.slice(0, maxOutputLength) + '\n... (output truncated)'
            : result.stderr

        return {
          toolCallId,
          output: { 
            stdout: truncatedStdout,
            stderr: truncatedStderr,
            exitCode: 0,
            command,
            cwd: resolvedCwd.logicalPath
          },
          isError: false
        }
      } catch (error) {
        // AbortError from signal
        if (error instanceof DOMException && error.name === 'AbortError') {
          return {
            toolCallId,
            output: { error: 'Command execution aborted: task was canceled or paused', command },
            isError: true
          }
        }

        if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
          const execError = error as { stdout: string; stderr: string; code?: number; signal?: NodeJS.Signals }
          const stderr = execError.stderr?.slice(0, maxOutputLength) ?? ''
          const stdout = execError.stdout?.slice(0, maxOutputLength) ?? ''
          return {
            toolCallId,
            output: { 
              stdout,
              stderr,
              exitCode: execError.code ?? 1,
              command,
              cwd: resolvedCwdLogical
            },
            isError: true
          }
        }
        return {
          toolCallId,
          output: { error: error instanceof Error ? error.message : String(error), command },
          isError: true
        }
      }
    }
  }
}

export const runCommandTool = createRunCommandTool()
