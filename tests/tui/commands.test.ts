
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { handleCommand } from '../../src/interfaces/tui/commands.js'
import type { CommandContext } from '../../src/interfaces/tui/commands.js'
import type { App } from '../../src/interfaces/app/createApp.js'
import type { LLMProfile } from '../../src/core/ports/llmClient.js'

describe('tui/commands', () => {
  function createContext(partialApp: Partial<App>, overrides: Partial<CommandContext> = {}) {
    const baseContext: CommandContext = {
      app: partialApp as App,
      refresh: vi.fn(),
      setStatus: vi.fn(),
      setReplayOutput: vi.fn(),
      focusedTaskId: null,
      setFocusedTaskId: vi.fn(),
      setShowTasks: vi.fn(),
      setShowVerbose: vi.fn(),
      setStreamingEnabled: vi.fn()
    }
    return { ...baseContext, ...overrides }
  }

  describe('replay command', () => {
    it('formats tool output using formatToolOutput', async () => {
      const mockGetMessages = vi.fn().mockResolvedValue([
        {
          role: 'tool',
          toolName: 'grepTool',
          content: JSON.stringify({ content: 'match1\nmatch2', count: 2, strategy: 'git grep' }),
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

      const ctx = createContext(mockApp, { focusedTaskId: 'task-1' })

      await handleCommand('/replay task-1', ctx)

      expect(ctx.setReplayOutput).toHaveBeenCalled()
      const entries = (ctx.setReplayOutput as any).mock.calls[0][0]
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

      const ctx = createContext(mockApp, { focusedTaskId: 'task-1' })

      await handleCommand('/replay task-1', ctx)

      const entries = (ctx.setReplayOutput as any).mock.calls[0][0]
      const toolEntry = entries.find((e: any) => e.content.includes('runCommand result:'))
      expect(toolEntry).toBeDefined()
      expect(toolEntry.content).toContain('Exit 1')
      expect(toolEntry.color).toBe('gray')
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

      const ctx = createContext(mockApp, { focusedTaskId: 'task-1' })

      await handleCommand('/replay task-1', ctx)

      const entries = (ctx.setReplayOutput as any).mock.calls[0][0]
      const toolEntry = entries.find((e: any) => e.content.includes('someTool result:'))
      expect(toolEntry.color).toBe('red')
      expect(toolEntry.prefix).toContain('✖')
    })
  })

  describe('agent command', () => {
    it('lists agents when no target provided', async () => {
      let activeAgentId = 'agent_a'
      const agentA = { id: 'agent_a', displayName: 'Agent A', description: 'First', toolGroups: [], defaultProfile: 'fast' as LLMProfile }
      const agentB = { id: 'agent_b', displayName: 'Agent B', description: 'Second', toolGroups: [], defaultProfile: 'fast' as LLMProfile }
      const runtimeManager = {
        agents: new Map([
          ['agent_a', agentA],
          ['agent_b', agentB]
        ]),
        get defaultAgentId() {
          return activeAgentId
        },
        set defaultAgentId(value: string) {
          activeAgentId = value
        }
      }

      const ctx = createContext({ runtimeManager } as unknown as App)

      await handleCommand('/agent', ctx)

      expect(ctx.setReplayOutput).toHaveBeenCalled()
      expect(ctx.setStatus).toHaveBeenCalledWith('Active agent: agent_a')
    })

    it('switches default agent by prefix match', async () => {
      let activeAgentId = 'agent_a'
      const runtimeManager = {
        agents: new Map([
          ['agent_a', { id: 'agent_a', displayName: 'Alpha', description: 'First', toolGroups: [], defaultProfile: 'fast' as LLMProfile }],
          ['agent_b', { id: 'agent_b', displayName: 'Beta', description: 'Second', toolGroups: [], defaultProfile: 'fast' as LLMProfile }]
        ]),
        get defaultAgentId() {
          return activeAgentId
        },
        set defaultAgentId(value: string) {
          activeAgentId = value
        }
      }

      const ctx = createContext({ runtimeManager } as unknown as App)

      await handleCommand('/agent bet', ctx)

      expect(activeAgentId).toBe('agent_b')
      expect(ctx.setStatus).toHaveBeenCalledWith('Active agent set to: Beta (agent_b)')
    })
  })

  describe('model command', () => {
    it('shows current model and profile', async () => {
      const runtimeManager = {
        getProfileOverride: vi.fn().mockReturnValue('fast'),
        clearProfileOverride: vi.fn(),
        setProfileOverride: vi.fn()
      }
      const app = {
        runtimeManager,
        llm: { label: 'TestLLM', description: 'Demo' }
      } as unknown as App
      const ctx = createContext(app)

      await handleCommand('/model', ctx)

      expect(ctx.setStatus).toHaveBeenCalledWith('LLM: TestLLM – Demo │ Profile: fast')
    })

    it('clears profile override', async () => {
      const runtimeManager = {
        getProfileOverride: vi.fn(),
        clearProfileOverride: vi.fn(),
        setProfileOverride: vi.fn()
      }
      const app = {
        runtimeManager,
        llm: { label: 'TestLLM', description: 'Demo' }
      } as unknown as App
      const ctx = createContext(app)

      await handleCommand('/model reset', ctx)

      expect(runtimeManager.clearProfileOverride).toHaveBeenCalledWith('*')
      expect(ctx.setStatus).toHaveBeenCalledWith('Profile override cleared. Agents will use their own defaults.')
    })

    it('rejects invalid profile', async () => {
      const runtimeManager = {
        getProfileOverride: vi.fn(),
        clearProfileOverride: vi.fn(),
        setProfileOverride: vi.fn()
      }
      const app = {
        runtimeManager,
        llm: { label: 'TestLLM', description: 'Demo' }
      } as unknown as App
      const ctx = createContext(app)

      await handleCommand('/model unknown', ctx)

      expect(ctx.setStatus).toHaveBeenCalledWith('Invalid profile: unknown. Choose: fast, writer, reasoning')
    })
  })

  describe('task commands', () => {
    it('creates a task and focuses it', async () => {
      const createTask = vi.fn().mockResolvedValue({ taskId: 'task_123' })
      const app = {
        taskService: { createTask },
        runtimeManager: { defaultAgentId: 'agent_seed_chat' }
      } as unknown as App
      const ctx = createContext(app)

      await handleCommand('/new Task Title', ctx)

      expect(ctx.setFocusedTaskId).toHaveBeenCalledWith('task_123')
      expect(ctx.setStatus).toHaveBeenCalledWith('Task created and focused: task_123')
    })

    it('focuses the next task', async () => {
      const tasks = [
        { taskId: 'task_a' },
        { taskId: 'task_b' }
      ]
      const app = {
        taskService: { listTasks: vi.fn().mockResolvedValue({ tasks }) }
      } as unknown as App
      const ctx = createContext(app, { focusedTaskId: 'task_a' })

      await handleCommand('/next', ctx)

      expect(ctx.setFocusedTaskId).toHaveBeenCalledWith('task_b')
    })

    it('handles focus for missing task id', async () => {
      const app = {
        taskService: { getTask: vi.fn().mockResolvedValue(null) }
      } as unknown as App
      const ctx = createContext(app)

      await handleCommand('/focus task_missing', ctx)

      expect(ctx.setStatus).toHaveBeenCalledWith('Task not found: task_missing')
    })
  })

  describe('replay-raw command', () => {
    it('replays raw conversation lines for a task', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'seed-'))
      const conversationsPath = join(dir, 'conversations.jsonl')
      writeFileSync(
        conversationsPath,
        [
          '{"taskId":"task_a","role":"user","content":"Hello"}',
          '{"taskId":"task_b","role":"user","content":"Hi"}'
        ].join('\n'),
        'utf8'
      )

      const app = {
        conversationsPath,
        taskService: { listTasks: vi.fn().mockResolvedValue({ tasks: [] }) }
      } as unknown as App

      const ctx = createContext(app)

      await handleCommand('/replay-raw task_a', ctx)

      const entries = (ctx.setReplayOutput as any).mock.calls[0][0]
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toContain('"taskId":"task_a"')

      rmSync(dir, { recursive: true, force: true })
    })
  })

  describe('verbose and stream commands', () => {
    it('toggles verbose when no args provided', async () => {
      const ctx = createContext({} as App)

      await handleCommand('/verbose', ctx)

      expect(ctx.setShowVerbose).toHaveBeenCalled()
      expect(ctx.setStatus).toHaveBeenCalledWith('Verbose output toggled')
    })

    it('toggles streaming state', async () => {
      const runtimeManager = { streamingEnabled: false }
      const app = { runtimeManager } as unknown as App
      const ctx = createContext(app)

      await handleCommand('/stream', ctx)

      expect(runtimeManager.streamingEnabled).toBe(true)
      expect(ctx.setStreamingEnabled).toHaveBeenCalledWith(true)
      expect(ctx.setStatus).toHaveBeenCalledWith('Streaming enabled')
    })
  })
})
