/**
 * HTTP API — Hono routes for task management, interactions, events, audit, and runtime control.
 *
 * Design:
 * - Single `createHttpApp()` factory builds the full Hono app.
 * - Auth: Bearer token middleware on all /api/* routes.
 * - Static file serving for the Web UI SPA (from web/dist/).
 * - Zod validation on all POST bodies.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { resolve, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { TaskService } from '../../../application/services/taskService.js'
import type { InteractionService } from '../../../application/services/interactionService.js'
import type { EventService } from '../../../application/services/eventService.js'
import type { AuditService } from '../../../application/services/auditService.js'
import type { RuntimeManager } from '../../../agents/orchestration/runtimeManager.js'
import type { ArtifactStore } from '../../../core/ports/artifactStore.js'
import type { ConversationStore } from '../../../core/ports/conversationStore.js'
import { TaskPrioritySchema } from '../../../core/entities/task.js'
import {
  createTaskGroupMembers,
  requireTopLevelCallerTask,
  TaskGroupCreationError
} from '../../task-groups/taskGroupCreation.js'

// ============================================================================
// Request Schemas
// ============================================================================

const CreateTaskBodySchema = z.object({
  title: z.string().min(1),
  intent: z.string().optional(),
  priority: TaskPrioritySchema.optional(),
  agentId: z.string().optional(),
  parentTaskId: z.string().optional(),
})

const CreateTaskGroupBodySchema = z.object({
  tasks: z.array(z.object({
    agentId: z.string().min(1),
    title: z.string().min(1),
    intent: z.string().optional(),
    priority: TaskPrioritySchema.optional()
  })).min(1)
})

const CancelTaskBodySchema = z.object({
  reason: z.string().optional(),
})

const PauseTaskBodySchema = z.object({
  reason: z.string().optional(),
})

const ResumeTaskBodySchema = z.object({
  reason: z.string().optional(),
})

const InstructionBodySchema = z.object({
  instruction: z.string().min(1),
})

const RespondBodySchema = z.object({
  selectedOptionId: z.string().optional(),
  inputValue: z.string().optional(),
  comment: z.string().optional(),
})

const ProfileBodySchema = z.object({
  profile: z.string().min(1),
})

const StreamingBodySchema = z.object({
  enabled: z.boolean(),
})

const FileReadQuerySchema = z.object({
  path: z.string().min(1),
})

const FileWriteBodySchema = z.object({
  path: z.string().min(1),
  content: z.string(),
})

// ============================================================================
// Dependencies
// ============================================================================

export interface HttpAppDeps {
  taskService: TaskService
  interactionService: InteractionService
  eventService: EventService
  auditService: AuditService
  runtimeManager: RuntimeManager
  artifactStore: ArtifactStore
  conversationStore: ConversationStore
  authToken: string
  baseDir: string
}

// ============================================================================
// App Factory
// ============================================================================

export function createHttpApp(deps: HttpAppDeps): Hono {
  const app = new Hono()

  // ── CORS ──
  app.use('/api/*', cors({ origin: ['http://localhost:*', 'http://127.0.0.1:*'], allowMethods: ['GET', 'POST', 'OPTIONS'] }))

  // ── Error handling ──
  app.onError((err, c) => {
    const status = (err as { status?: number }).status ?? 500
    // Only expose error messages for client errors; generic message for server errors (B28)
    const message = status < 500 && err instanceof Error
      ? err.message
      : 'Internal server error'
    if (status >= 500) {
      console.error('[httpServer] Internal error:', err instanceof Error ? err.stack ?? err.message : err)
    }
    return c.json({ error: message }, status as 400)
  })

  // ── Health (no auth) ──
  app.get('/api/health', (c) =>
    c.json({
      status: 'ok',
      pid: process.pid,
      uptime: process.uptime(),
    }),
  )

  // ── Auth middleware (after health) ──
  app.use('/api/*', async (c, next) => {
    // Health endpoint already handled above, skip auth for it
    if (c.req.path === '/api/health') {
      await next()
      return
    }
    // Bypass auth for localhost connections (server only binds 127.0.0.1 by default).
    // The enclosing http.Server sets X-Remote-Address from req.socket.remoteAddress.
    const remoteAddr = c.req.header('x-remote-address')
    if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1') {
      await next()
      return
    }
    const header = c.req.header('Authorization')
    if (header === `Bearer ${deps.authToken}`) {
      await next()
      return
    }
    // Also allow token as query parameter (for SSE)
    const url = new URL(c.req.url)
    if (url.searchParams.get('token') === deps.authToken) {
      await next()
      return
    }
    return c.json({ error: 'Unauthorized' }, 401)
  })

  // ── Tasks ──
  app.get('/api/tasks', async (c) => {
    const { tasks } = await deps.taskService.listTasks()
    return c.json({ tasks })
  })

  app.get('/api/tasks/:id', async (c) => {
    c.header('Cache-Control', 'no-store')
    const task = await deps.taskService.getTask(c.req.param('id'))
    if (!task) return c.json({ error: 'Task not found' }, 404)
    return c.json(task)
  })

  app.post('/api/tasks', async (c) => {
    const body = CreateTaskBodySchema.parse(await c.req.json())
    const agentId = body.agentId ?? deps.runtimeManager.defaultAgentId
    const result = await deps.taskService.createTask({ title: body.title, intent: body.intent, priority: body.priority, agentId, parentTaskId: body.parentTaskId })
    return c.json(result, 201)
  })

  app.post('/api/tasks/:id/group', async (c) => {
    const rawBody = await c.req.json().catch(() => ({}))
    const parsedBody = CreateTaskGroupBodySchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return c.json({ error: 'Invalid request body for task group creation' }, 400)
    }

    try {
      const callerTask = await requireTopLevelCallerTask(deps.taskService, c.req.param('id'), {
        notTopLevelMessage: 'Task group creation is only available to top-level tasks'
      })

      const result = await createTaskGroupMembers({
        taskService: deps.taskService,
        runtimeManager: deps.runtimeManager,
        rootTaskId: callerTask.taskId,
        callerAgentId: callerTask.agentId,
        tasks: parsedBody.data.tasks
      })

      return c.json(result, 201)
    } catch (error) {
      if (error instanceof TaskGroupCreationError) {
        return c.json({ error: error.message }, 400)
      }
      throw error
    }
  })

  app.post('/api/tasks/:id/cancel', async (c) => {
    const body = CancelTaskBodySchema.parse(await c.req.json().catch(() => ({})))
    await deps.taskService.cancelTask(c.req.param('id'), body.reason)
    return c.json({ ok: true })
  })

  app.post('/api/tasks/:id/pause', async (c) => {
    const body = PauseTaskBodySchema.parse(await c.req.json().catch(() => ({})))
    await deps.taskService.pauseTask(c.req.param('id'), body.reason)
    return c.json({ ok: true })
  })

  app.post('/api/tasks/:id/resume', async (c) => {
    const body = ResumeTaskBodySchema.parse(await c.req.json().catch(() => ({})))
    await deps.taskService.resumeTask(c.req.param('id'), body.reason)
    return c.json({ ok: true })
  })

  app.post('/api/tasks/:id/instruction', async (c) => {
    const body = InstructionBodySchema.parse(await c.req.json())
    await deps.taskService.addInstruction(c.req.param('id'), body.instruction)
    return c.json({ ok: true })
  })

  // ── Events ──
  app.get('/api/events', async (c) => {
    const rawAfter = c.req.query('after') ?? '0'
    const rawLimit = c.req.query('limit')
    const after = parseInt(rawAfter, 10)
    if (isNaN(after) || after < 0) {
      return c.json({ error: 'Invalid \'after\' parameter: must be a non-negative integer' }, 400)
    }
    const streamId = c.req.query('streamId')
    let events = await deps.eventService.getEventsAfter(after)
    if (streamId) {
      events = events.filter(e => e.streamId === streamId)
    }
    // Apply limit (B25)
    if (rawLimit !== undefined) {
      const limit = parseInt(rawLimit, 10)
      if (isNaN(limit) || limit < 1) {
        return c.json({ error: 'Invalid \'limit\' parameter: must be a positive integer' }, 400)
      }
      events = events.slice(0, Math.min(limit, 500))
    }
    return c.json({ events })
  })

  app.get('/api/events/:id', async (c) => {
    const event = await deps.eventService.getEventById(Number(c.req.param('id')))
    if (!event) return c.json({ error: 'Event not found' }, 404)
    return c.json(event)
  })

  app.get('/api/tasks/:id/events', async (c) => {
    const events = await deps.eventService.replayEvents(c.req.param('id'))
    return c.json({ events })
  })

  // ── Conversations ──
  app.get('/api/tasks/:id/conversation', async (c) => {
    c.header('Cache-Control', 'no-store')
    const messages = await deps.conversationStore.getMessages(c.req.param('id'))
    return c.json({ messages })
  })

  // ── Interactions ──
  app.get('/api/tasks/:taskId/interaction/pending', async (c) => {
    c.header('Cache-Control', 'no-store')
    const pending = await deps.interactionService.getPendingInteraction(c.req.param('taskId'))
    return c.json({ pending })
  })

  app.post('/api/tasks/:taskId/interaction/:interactionId/respond', async (c) => {
    const body = RespondBodySchema.parse(await c.req.json())
    await deps.interactionService.respondToInteraction(c.req.param('taskId'), c.req.param('interactionId'), body)
    return c.json({ ok: true })
  })

  // ── Audit ──
  app.get('/api/audit', async (c) => {
    const taskId = c.req.query('taskId')
    const rawLimit = c.req.query('limit') ?? '50'
    const limit = parseInt(rawLimit, 10)
    if (isNaN(limit) || limit < 1) {
      return c.json({ error: 'Invalid \'limit\' parameter: must be a positive integer' }, 400)
    }
    const entries = await deps.auditService.getRecentEntries(taskId || undefined, Math.min(limit, 500))
    return c.json({ entries })
  })

  // ── Runtime ──
  app.get('/api/runtime', (c) => {
    const agents = [...deps.runtimeManager.agents.values()].map((a) => ({
      id: a.id,
      displayName: a.displayName,
      description: a.description,
    }))
    return c.json({
      defaultAgentId: deps.runtimeManager.defaultAgentId,
      streamingEnabled: deps.runtimeManager.streamingEnabled,
      agents,
      llm: {
        provider: deps.runtimeManager.llmProvider,
        defaultProfile: deps.runtimeManager.profileCatalog.defaultProfile,
        profiles: deps.runtimeManager.profileCatalog.profiles,
        globalProfileOverride: deps.runtimeManager.getProfileOverride('*') ?? null,
      },
    })
  })

  app.post('/api/runtime/profile', async (c) => {
    const body = ProfileBodySchema.parse(await c.req.json())
    if (!deps.runtimeManager.isValidProfile(body.profile)) {
      const validProfiles = deps.runtimeManager.availableProfiles
      return c.json(
        { error: `Invalid profile: ${body.profile}. Choose: ${validProfiles.join(', ')}` },
        400,
      )
    }
    deps.runtimeManager.setProfileOverride('*', body.profile)
    return c.json({ ok: true })
  })

  app.post('/api/runtime/profile/clear', (c) => {
    deps.runtimeManager.clearProfileOverride('*')
    return c.json({ ok: true })
  })

  app.post('/api/runtime/streaming', async (c) => {
    const body = StreamingBodySchema.parse(await c.req.json())
    deps.runtimeManager.streamingEnabled = body.enabled
    return c.json({ ok: true })
  })

  // ── Files ──
  app.get('/api/files', async (c) => {
    const { path: filePath } = FileReadQuerySchema.parse({ path: c.req.query('path') })
    await validatePath(filePath, deps.baseDir)
    const content = await deps.artifactStore.readFile(filePath)
    return c.json({ path: filePath, content })
  })

  app.post('/api/files', async (c) => {
    const body = FileWriteBodySchema.parse(await c.req.json())
    await validatePath(body.path, deps.baseDir)
    await deps.artifactStore.writeFile(body.path, body.content)
    return c.json({ ok: true })
  })

  return app
}

// ============================================================================
// Security Helpers
// ============================================================================

/**
 * Prevent directory traversal — resolved path must stay within baseDir.
 *
 * Uses allowlist approach: resolves the path, then verifies it starts with baseDir.
 * Also resolves symlinks via realpath to prevent symlink traversal (B29).
 */
async function validatePath(filePath: string, baseDir: string): Promise<void> {
  // Reject obviously invalid paths early
  if (!filePath || filePath.includes('\0')) {
    const err = new Error('Invalid path: must be non-empty and not contain null bytes') as Error & { status: number }
    err.status = 400
    throw err
  }

  // Reject absolute paths
  if (filePath.startsWith('/') || filePath.startsWith('\\')) {
    const err = new Error('Invalid path: must be relative') as Error & { status: number }
    err.status = 400
    throw err
  }

  // String-based check first (fast path)
  const resolved = resolve(baseDir, filePath)
  const normalizedBase = resolve(baseDir)
  if (!resolved.startsWith(normalizedBase + sep) && resolved !== normalizedBase) {
    const err = new Error('Invalid path: must not escape workspace directory') as Error & { status: number }
    err.status = 400
    throw err
  }

  // Symlink check: resolve real path and verify it's still within baseDir (B29)
  try {
    const realBase = await realpath(normalizedBase)
    // Walk up from the resolved path to find the deepest existing ancestor
    let checkPath = resolved
    let realCheck: string | undefined
    while (checkPath !== normalizedBase) {
      try {
        realCheck = await realpath(checkPath)
        break
      } catch {
        // Path doesn't exist yet (e.g. new file for write) — check parent
        checkPath = resolve(checkPath, '..')
      }
    }
    if (!realCheck) realCheck = realBase // Fallback to base if nothing exists

    if (!realCheck.startsWith(realBase + sep) && realCheck !== realBase) {
      const err = new Error('Invalid path: symlink escapes workspace directory') as Error & { status: number }
      err.status = 400
      throw err
    }
  } catch (e) {
    if ((e as { status?: number }).status === 400) throw e
    // If realpath itself fails (e.g. baseDir gone), fall through to string check above
  }
}
