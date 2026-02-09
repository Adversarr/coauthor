
import { describe, it, expect, vi } from 'vitest'
import { handleCommand } from '../../src/tui/commands.js'
import type { CommandContext } from '../../src/tui/commands.js'
import type { App } from '../../src/app/createApp.js'

describe('tui/commands', () => {
  describe('replay command', () => {
    it('formats tool output using formatToolOutput', async () => {
      const mockGetMessages = vi.fn().mockResolvedValue([
        {
          role: 'tool',
          toolName: 'grepTool',
          content: 'match1\nmatch2',
          toolCallId: 'call-1'
        }
      ])

      const mockApp = {
        conversationStore: {
          getMessages: mockGetMessages
        },
        taskService: {
          listTasks: vi.fn().mockResolvedValue({ tasks: [] })
        }
      } as unknown as App

      const mockSetReplayOutput = vi.fn()
      const mockSetStatus = vi.fn()
      
      const ctx: CommandContext = {
        app: mockApp,
        refresh: vi.fn(),
        setStatus: mockSetStatus,
        setReplayOutput: mockSetReplayOutput,
        focusedTaskId: 'task-1',
        setFocusedTaskId: vi.fn(),
        setShowTasks: vi.fn(),
        setShowVerbose: vi.fn()
      }

      await handleCommand('/replay task-1', ctx)

      expect(mockSetReplayOutput).toHaveBeenCalled()
      const entries = mockSetReplayOutput.mock.calls[0][0]
      const toolEntry = entries.find((e: any) => e.content.includes('grepTool result:'))
      expect(toolEntry).toBeDefined()
      expect(toolEntry.content).toContain('Found 2 matches')
    })

    it('formats tool error correctly', async () => {
      const mockGetMessages = vi.fn().mockResolvedValue([
        {
          role: 'tool',
          toolName: 'runCommand',
          content: JSON.stringify({ exitCode: 1, stderr: 'failed' }),
          toolCallId: 'call-1'
        }
      ])

      const mockApp = {
        conversationStore: {
          getMessages: mockGetMessages
        },
        taskService: {
          listTasks: vi.fn().mockResolvedValue({ tasks: [] })
        }
      } as unknown as App

      const mockSetReplayOutput = vi.fn()
      
      const ctx: CommandContext = {
        app: mockApp,
        refresh: vi.fn(),
        setStatus: vi.fn(),
        setReplayOutput: mockSetReplayOutput,
        focusedTaskId: 'task-1',
        setFocusedTaskId: vi.fn(),
        setShowTasks: vi.fn(),
        setShowVerbose: vi.fn()
      }

      await handleCommand('/replay task-1', ctx)

      const entries = mockSetReplayOutput.mock.calls[0][0]
      const toolEntry = entries.find((e: any) => e.content.includes('runCommand result:'))
      expect(toolEntry).toBeDefined()
      expect(toolEntry.content).toContain('Exit 1')
      expect(toolEntry.color).toBe('gray') // It seems my logic sets color to gray if NOT error, but 'red' if error. 
      // Wait, let's check my logic in commands.ts:
      // const color = isError ? 'red' : 'gray'
      // And isError is determined by: record.isError === true || typeof record.error === 'string'
      // My content is { exitCode: 1, stderr: 'failed' }. It does NOT have isError: true or error: string.
      // So it will be treated as success in terms of color/prefix, but the text will show "Exit 1".
      // This matches current logic.
      expect(toolEntry.content).toContain('failed...')
    })

    it('handles explicit error object', async () => {
        const mockGetMessages = vi.fn().mockResolvedValue([
          {
            role: 'tool',
            toolName: 'someTool',
            content: JSON.stringify({ isError: true, error: 'Something bad' }),
            toolCallId: 'call-1'
          }
        ])
  
        const mockApp = {
          conversationStore: {
            getMessages: mockGetMessages
          },
          taskService: {
            listTasks: vi.fn().mockResolvedValue({ tasks: [] })
          }
        } as unknown as App
  
        const mockSetReplayOutput = vi.fn()
        
        const ctx: CommandContext = {
          app: mockApp,
          refresh: vi.fn(),
          setStatus: vi.fn(),
          setReplayOutput: mockSetReplayOutput,
          focusedTaskId: 'task-1',
          setFocusedTaskId: vi.fn(),
          setShowTasks: vi.fn(),
          setShowVerbose: vi.fn()
        }
  
        await handleCommand('/replay task-1', ctx)
  
        const entries = mockSetReplayOutput.mock.calls[0][0]
        const toolEntry = entries.find((e: any) => e.content.includes('someTool result:'))
        expect(toolEntry.color).toBe('red')
        expect(toolEntry.prefix).toContain('✖')
      })
  })
})
