/**
 * Tests for HTTP API routes: tasks, events, interactions, audit, runtime, files, auth.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createHttpApp, type HttpAppDeps } from '../../src/infrastructure/servers/http/httpServer.js'
import { InMemoryEventStore } from '../helpers/inMemoryEventStore.js'
import { TaskService } from '../../src/application/services/taskService.js'
import { EventService } from '../../src/application/services/eventService.js'
import { InteractionService } from '../../src/application/services/interactionService.js'
import { AuditService } from '../../src/application/services/auditService.js'
import type { ConversationStore } from '../../src/core/ports/conversationStore.js'

// ── Mock Factories ──

function createMockRuntimeManager() {
  let globalProfileOverride: string | undefined
  const profiles = [
    { id: 'fast', model: 'm-fast', clientPolicy: 'default', builtin: true },
    { id: 'writer', model: 'm-writer', clientPolicy: 'default', builtin: true },
    { id: 'reasoning', model: 'm-reasoning', clientPolicy: 'default', builtin: true },
    { id: 'research_web', model: 'm-web', clientPolicy: 'web', builtin: false },
  ]
  return {
    defaultAgentId: 'agent-default',
    streamingEnabled: false,
    llmProvider: 'openai',
    profileCatalog: {
      defaultProfile: 'fast',
      profiles,
    },
    availableProfiles: profiles.map((profile) => profile.id),
    isValidProfile: (profile: string) => profiles.some((item) => item.id === profile),
    agents: new Map([
      ['agent-default', { id: 'agent-default', displayName: 'Default', description: 'Default agent', toolGroups: [], defaultProfile: 'fast' as const, run: async function* () {} }],
    ]),
    setProfileOverride: (_taskId: string, profile: string) => { globalProfileOverride = profile },
    getProfileOverride: () => globalProfileOverride,
    clearProfileOverride: () => { globalProfileOverride = undefined },
    registerAgent: () => {},
    start: () => {},
    stop: () => {},
    waitForIdle: async () => {},
    isRunning: true,
  }
}

function createMockArtifactStore() {
  const files = new Map<string, string>([['sample.txt', 'hello world']])
  return {
    readFile: async (path: string) => {
      const content = files.get(path)
      if (!content) throw new Error('Not found')
      return content
    },
    writeFile: async (path: string, content: string) => { files.set(path, content) },
    exists: async (path: string) => files.has(path),
    listDir: async () => [],
    glob: async () => [],
    stat: async () => ({ isFile: true, isDirectory: false, size: 0 }),
  }
}

function createMockAuditLog() {
  const { Subject } = require('rxjs') as typeof import('rxjs')
  return {
    entries$: new Subject(),
    append: async () => {},
    ensureSchema: async () => {},
    readByTask: async () => [],
    readAll: async () => [],
  }
}

function createMockConversationStore(): ConversationStore {
  const conversations = new Map<string, Array<Record<string, unknown>>>()
  return {
    ensureSchema: async () => {},
    append: async (taskId, message) => {
      const existing = conversations.get(taskId) ?? []
      existing.push(message as Record<string, unknown>)
      conversations.set(taskId, existing)
      return {
        id: existing.length,
        taskId,
        index: existing.length - 1,
        message,
        createdAt: new Date().toISOString(),
      }
    },
    getMessages: async (taskId) => {
      return (conversations.get(taskId) ?? []) as never[]
    },
    truncate: async () => {},
    clear: async (taskId) => {
      conversations.delete(taskId)
    },
    readAll: async () => [],
  }
}

const AUTH_TOKEN = 'test-auth-token'

// ── Setup ──

function createTestApp() {
  const store = new InMemoryEventStore()
  const taskService = new TaskService(store)
  const eventService = new EventService(store)
  const interactionService = new InteractionService(store)
  const auditLog = createMockAuditLog()
  const auditService = new AuditService(auditLog)

  const deps: HttpAppDeps = {
    taskService,
    interactionService,
    eventService,
    auditService,
    runtimeManager: createMockRuntimeManager() as unknown as HttpAppDeps['runtimeManager'],
    artifactStore: createMockArtifactStore() as unknown as HttpAppDeps['artifactStore'],
    conversationStore: createMockConversationStore(),
    authToken: AUTH_TOKEN,
    baseDir: '/tmp/test',
  }

  return { app: createHttpApp(deps), store, taskService, interactionService }
}

async function request(app: ReturnType<typeof createHttpApp>, method: string, path: string, body?: unknown, token = AUTH_TOKEN) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  const init: RequestInit = { method, headers }
  if (body) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  return app.request(path, init)
}

// ── Tests ──

describe('HTTP API', () => {
  let app: ReturnType<typeof createHttpApp>
  let store: InMemoryEventStore
  let taskService: TaskService

  beforeEach(() => {
    const t = createTestApp()
    app = t.app
    store = t.store
    taskService = t.taskService
  })

  // ── Auth ──

  describe('Auth', () => {
    it('rejects requests without auth', async () => {
      const res = await app.request('/api/tasks', { method: 'GET' })
      expect(res.status).toBe(401)
    })

    it('rejects requests with wrong token', async () => {
      const res = await request(app, 'GET', '/api/tasks', undefined, 'wrong-token')
      expect(res.status).toBe(401)
    })

    it('accepts requests with valid Bearer token', async () => {
      const res = await request(app, 'GET', '/api/tasks')
      expect(res.status).toBe(200)
    })

    it('accepts token as query parameter', async () => {
      const res = await app.request(`/api/tasks?token=${AUTH_TOKEN}`, { method: 'GET' })
      expect(res.status).toBe(200)
    })
  })

  // ── Health ──

  describe('Health', () => {
    it('returns health without auth', async () => {
      const res = await app.request('/api/health')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('ok')
      expect(body.pid).toBe(process.pid)
    })
  })

  // ── Tasks ──

  describe('Tasks', () => {
    it('lists tasks (empty)', async () => {
      const res = await request(app, 'GET', '/api/tasks')
      expect(res.status).toBe(200)
      const body = await res.json() as { tasks: unknown[] }
      expect(Array.isArray(body.tasks)).toBe(true)
      expect(body.tasks).toHaveLength(0)
    })

    it('creates a task', async () => {
      const res = await request(app, 'POST', '/api/tasks', { title: 'Test Task' })
      expect(res.status).toBe(201)
      const body = await res.json() as { taskId: string }
      expect(body.taskId).toBeDefined()
    })

    it('gets a task by ID', async () => {
      const { taskId } = await taskService.createTask({ title: 'My Task', agentId: 'agent-default' })
      const res = await request(app, 'GET', `/api/tasks/${taskId}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = await res.json() as { taskId: string; title: string }
      expect(body.title).toBe('My Task')
    })

    it('returns 404 for missing task', async () => {
      const res = await request(app, 'GET', '/api/tasks/nonexistent')
      expect(res.status).toBe(404)
    })

    it('cancels a task', async () => {
      const { taskId } = await taskService.createTask({ title: 'Cancel Me', agentId: 'a' })
      const res = await request(app, 'POST', `/api/tasks/${taskId}/cancel`, { reason: 'done' })
      expect(res.status).toBe(200)

      const task = await taskService.getTask(taskId)
      expect(task?.status).toBe('canceled')
    })

    it('adds instruction to in-progress task', async () => {
      const { taskId } = await taskService.createTask({ title: 'Work', agentId: 'a' })
      // Simulate start
      await store.append(taskId, [{ type: 'TaskStarted', payload: { taskId, agentId: 'a', authorActorId: 'user' } }])

      const res = await request(app, 'POST', `/api/tasks/${taskId}/instruction`, { instruction: 'do more' })
      expect(res.status).toBe(200)
    })

    it('rejects create without title', async () => {
      const res = await request(app, 'POST', '/api/tasks', {})
      expect(res.status).toBe(500) // Zod validation error caught by onError
    })

    it('creates task group members from a top-level task', async () => {
      const { taskId } = await taskService.createTask({ title: 'Group Root', agentId: 'agent-default' })

      const res = await request(app, 'POST', `/api/tasks/${taskId}/group`, {
        tasks: [{ agentId: 'agent-default', title: 'Child A', intent: 'Do child work', priority: 'normal' }],
      })

      expect(res.status).toBe(201)
      const body = await res.json() as { groupId: string; tasks: Array<{ taskId: string; agentId: string; title: string }> }
      expect(body.groupId).toBe(taskId)
      expect(body.tasks).toHaveLength(1)
      expect(body.tasks[0]?.title).toBe('Child A')

      const allTasks = (await taskService.listTasks()).tasks
      const createdChild = allTasks.find((task) => task.taskId === body.tasks[0]?.taskId)
      expect(createdChild?.parentTaskId).toBe(taskId)
    })

    it('returns 400 for invalid task group body', async () => {
      const { taskId } = await taskService.createTask({ title: 'Group Root', agentId: 'agent-default' })

      const res = await request(app, 'POST', `/api/tasks/${taskId}/group`, { tasks: [] })
      expect(res.status).toBe(400)
    })

    it('returns 400 when creating group from non-root task', async () => {
      const { taskId: rootTaskId } = await taskService.createTask({ title: 'Root', agentId: 'agent-default' })
      const { taskId: childTaskId } = await taskService.createTask({
        title: 'Child',
        agentId: 'agent-default',
        parentTaskId: rootTaskId
      })

      const res = await request(app, 'POST', `/api/tasks/${childTaskId}/group`, {
        tasks: [{ agentId: 'agent-default', title: 'Nested Child' }],
      })
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('top-level')
    })

    it('returns 400 for unknown group member agent', async () => {
      const { taskId } = await taskService.createTask({ title: 'Group Root', agentId: 'agent-default' })

      const res = await request(app, 'POST', `/api/tasks/${taskId}/group`, {
        tasks: [{ agentId: 'missing-agent', title: 'Child' }],
      })
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('Unknown or unavailable agentId')
    })

    it('pauses an in-progress task', async () => {
      const { taskId } = await taskService.createTask({ title: 'Pause Me', agentId: 'a' })
      await store.append(taskId, [{ type: 'TaskStarted', payload: { taskId, agentId: 'a', authorActorId: 'user' } }])
      const res = await request(app, 'POST', `/api/tasks/${taskId}/pause`)
      expect(res.status).toBe(200)
    })

    it('resumes a paused task', async () => {
      const { taskId } = await taskService.createTask({ title: 'Resume Me', agentId: 'a' })
      await store.append(taskId, [{ type: 'TaskStarted', payload: { taskId, agentId: 'a', authorActorId: 'user' } }])
      await store.append(taskId, [{ type: 'TaskPaused', payload: { taskId, authorActorId: 'user' } }])
      const res = await request(app, 'POST', `/api/tasks/${taskId}/resume`)
      expect(res.status).toBe(200)
    })
  })

  // ── Events ──

  describe('Events', () => {
    it('returns all events', async () => {
      await taskService.createTask({ title: 'T1', agentId: 'a' })
      await taskService.createTask({ title: 'T2', agentId: 'a' })
      const res = await request(app, 'GET', '/api/events')
      const body = await res.json() as { events: unknown[] }
      expect(body.events).toHaveLength(2)
    })

    it('returns events after cursor', async () => {
      await taskService.createTask({ title: 'T1', agentId: 'a' })
      await taskService.createTask({ title: 'T2', agentId: 'a' })
      const res = await request(app, 'GET', '/api/events?after=1')
      const body = await res.json() as { events: unknown[] }
      expect(body.events).toHaveLength(1)
    })

    it('returns events by task ID', async () => {
      const { taskId } = await taskService.createTask({ title: 'T1', agentId: 'a' })
      await taskService.createTask({ title: 'T2', agentId: 'a' })
      const res = await request(app, 'GET', `/api/tasks/${taskId}/events`)
      const body = await res.json() as { events: unknown[] }
      expect(body.events).toHaveLength(1)
    })

    it('returns event by ID', async () => {
      await taskService.createTask({ title: 'T1', agentId: 'a' })
      const res = await request(app, 'GET', '/api/events/1')
      expect(res.status).toBe(200)
      const body = await res.json() as { type: string }
      expect(body.type).toBe('TaskCreated')
    })

    it('returns 404 for missing event', async () => {
      const res = await request(app, 'GET', '/api/events/999')
      expect(res.status).toBe(404)
    })
  })

  // ── Interactions ──

  describe('Interactions', () => {
    it('returns null when no pending interaction', async () => {
      const { taskId } = await taskService.createTask({ title: 'T1', agentId: 'a' })
      const res = await request(app, 'GET', `/api/tasks/${taskId}/interaction/pending`)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = await res.json() as { pending: unknown }
      expect(body.pending).toBeNull()
    })

    it('returns pending interaction', async () => {
      const { taskId } = await taskService.createTask({ title: 'T1', agentId: 'a' })
      await store.append(taskId, [{ type: 'TaskStarted', payload: { taskId, agentId: 'a', authorActorId: 'user' } }])
      await store.append(taskId, [{
        type: 'UserInteractionRequested',
        payload: {
          interactionId: 'ui-1', taskId, kind: 'Input', purpose: 'generic',
          display: { title: 'Confirm?' }, authorActorId: 'agent',
        },
      }])
      const res = await request(app, 'GET', `/api/tasks/${taskId}/interaction/pending`)
      const body = await res.json() as { pending: { interactionId: string } }
      expect(body.pending?.interactionId).toBe('ui-1')
    })

    it('responds to interaction', async () => {
      const { taskId } = await taskService.createTask({ title: 'T1', agentId: 'a' })
      await store.append(taskId, [{ type: 'TaskStarted', payload: { taskId, agentId: 'a', authorActorId: 'user' } }])
      await store.append(taskId, [{
        type: 'UserInteractionRequested',
        payload: {
          interactionId: 'ui-2', taskId, kind: 'Input', purpose: 'generic',
          display: { title: 'Input?' }, authorActorId: 'agent',
        },
      }])
      const res = await request(app, 'POST', `/api/tasks/${taskId}/interaction/ui-2/respond`, {
        inputValue: 'yes',
      })
      expect(res.status).toBe(200)
    })
  })

  describe('Conversations', () => {
    it('returns conversation with no-store cache header', async () => {
      const { taskId } = await taskService.createTask({ title: 'T1', agentId: 'a' })
      const res = await request(app, 'GET', `/api/tasks/${taskId}/conversation`)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = await res.json() as { messages: unknown[] }
      expect(Array.isArray(body.messages)).toBe(true)
    })
  })

  // ── Runtime ──

  describe('Runtime', () => {
    it('returns runtime info', async () => {
      const res = await request(app, 'GET', '/api/runtime')
      const body = await res.json() as {
        defaultAgentId: string
        agents: unknown[]
        llm: { provider: string; defaultProfile: string; profiles: Array<{ id: string }>; globalProfileOverride: string | null }
      }
      expect(body.defaultAgentId).toBe('agent-default')
      expect(body.agents).toHaveLength(1)
      expect(body.llm.provider).toBe('openai')
      expect(body.llm.defaultProfile).toBe('fast')
      expect(body.llm.profiles.some((profile) => profile.id === 'research_web')).toBe(true)
      expect(body.llm.globalProfileOverride).toBeNull()
    })

    it('sets profile override', async () => {
      const res = await request(app, 'POST', '/api/runtime/profile', { profile: 'research_web' })
      expect(res.status).toBe(200)
    })

    it('clears profile override', async () => {
      await request(app, 'POST', '/api/runtime/profile', { profile: 'writer' })
      const res = await request(app, 'POST', '/api/runtime/profile/clear')
      expect(res.status).toBe(200)
    })

    it('toggles streaming', async () => {
      const res = await request(app, 'POST', '/api/runtime/streaming', { enabled: true })
      expect(res.status).toBe(200)
    })

    it('rejects invalid profile', async () => {
      const res = await request(app, 'POST', '/api/runtime/profile', { profile: 'invalid' })
      const body = await res.json() as { error: string }
      expect(res.status).toBe(400)
      expect(body.error).toContain('Invalid profile: invalid')
      expect(body.error).toContain('fast')
    })
  })

  // ── Files ──

  describe('Files', () => {
    it('reads a file', async () => {
      const res = await request(app, 'GET', '/api/files?path=sample.txt')
      expect(res.status).toBe(200)
      const body = await res.json() as { content: string }
      expect(body.content).toBe('hello world')
    })

    it('rejects directory traversal', async () => {
      const res = await request(app, 'GET', '/api/files?path=../etc/passwd')
      expect(res.status).toBe(400)
    })

    it('rejects absolute path', async () => {
      const res = await request(app, 'GET', '/api/files?path=/etc/passwd')
      expect(res.status).toBe(400)
    })

    it('writes a file', async () => {
      const res = await request(app, 'POST', '/api/files', { path: 'new.txt', content: 'new content' })
      expect(res.status).toBe(200)
    })
  })

  // ── Audit ──

  describe('Audit', () => {
    it('returns empty audit entries', async () => {
      const res = await request(app, 'GET', '/api/audit')
      expect(res.status).toBe(200)
      const body = await res.json() as { entries: unknown[] }
      expect(body.entries).toEqual([])
    })
  })
})
