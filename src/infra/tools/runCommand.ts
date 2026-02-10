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
import type { Tool, ToolContext, ToolResult } from '../../domain/ports/tool.js'
import { nanoid } from 'nanoid'

const DEFAULT_MAX_OUTPUT_LENGTH = 10000
const DEFAULT_TIMEOUT = 30000

export function createRunCommandTool(opts?: { maxOutputLength?: number; defaultTimeout?: number }): Tool {
  const maxOutputLength = opts?.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH
  const defaultTimeout = opts?.defaultTimeout ?? DEFAULT_TIMEOUT

  return {
    name: 'runCommand',
    description: 'Execute a shell command in the workspace directory. Returns stdout and stderr. Use with caution.',
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
      const isBackground = (args.isBackground as boolean) ?? false

      // Early abort check (PR-001)
      if (ctx.signal?.aborted) {
        return {
          toolCallId,
          output: { error: 'Command execution aborted: task was canceled or paused', command },
          isError: true
        }
      }

      try {
        if (isBackground) {
          // Run in background using spawn
          // We use 'sh -c' (or cmd on win) to execute string command
          const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
          const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command]
          
          const child = spawn(shell, shellArgs, {
            cwd: ctx.baseDir,
            detached: true,
            stdio: 'ignore' // Ignore output for background tasks? Or redirect? Reference gemini-cli says "Output hidden"
          })
          
          child.unref()

          return {
            toolCallId,
            output: {
              pid: child.pid,
              command,
              message: 'Command started in background'
            },
            isError: false
          }
        }

        // Foreground execution using exec
        const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          const child: ChildProcess = exec(command, {
            cwd: ctx.baseDir,
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
            command 
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
              command 
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

