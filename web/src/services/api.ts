/**
 * HTTP API client for the Seed backend.
 * All methods throw on non-ok responses.
 */

import type {
  TaskView,
  StoredEvent,
  CreateTaskResponse,
  CreateTaskGroupResponse,
  CreateTaskGroupTaskInput,
  PendingInteraction,
  HealthResponse,
  LLMMessage,
  RuntimeInfo,
} from '@/types'

const BASE = '' // same origin (Vite proxy in dev, served directly in prod)

function authHeaders(): HeadersInit {
  const token = sessionStorage.getItem('seed-token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Parse JSON or return undefined for empty/no-content responses (B21). */
async function parseJsonOrVoid<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 205) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

async function get<T>(path: string, opts?: { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders(), signal: opts?.signal })
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`)
  return parseJsonOrVoid<T>(res)
}

async function post<T>(path: string, body?: unknown, opts?: { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
    signal: opts?.signal,
  })
  if (!res.ok) throw new Error(`POST ${path}: ${res.status}`)
  return parseJsonOrVoid<T>(res)
}

// ── Public API ─────────────────────────────────────────────────────────

export const api = {
  health: () => get<HealthResponse>('/api/health'),

  // Tasks
  listTasks: (opts?: { signal?: AbortSignal }) => get<{ tasks: TaskView[] }>('/api/tasks', opts).then(r => r.tasks),
  getTask: (id: string, opts?: { signal?: AbortSignal }) => get<TaskView>(`/api/tasks/${id}`, opts),
  createTask: (body: { title: string; intent?: string; priority?: string; agentId?: string }) =>
    post<CreateTaskResponse>('/api/tasks', body),
  createTaskGroup: (taskId: string, body: { tasks: CreateTaskGroupTaskInput[] }) =>
    post<CreateTaskGroupResponse>(`/api/tasks/${taskId}/group`, body),
  cancelTask: (id: string, reason?: string) => post<void>(`/api/tasks/${id}/cancel`, { reason }),
  pauseTask: (id: string) => post<void>(`/api/tasks/${id}/pause`),
  resumeTask: (id: string) => post<void>(`/api/tasks/${id}/resume`),
  addInstruction: (id: string, instruction: string) =>
    post<void>(`/api/tasks/${id}/instruction`, { instruction }),

  // Events
  getEvents: (after = 0, streamId?: string, opts?: { signal?: AbortSignal }) => {
    const params = new URLSearchParams({ after: String(after) })
    if (streamId) params.set('streamId', streamId)
    return get<{ events: StoredEvent[] }>(`/api/events?${params}`, opts).then(r => r.events)
  },

  // Interactions
  getPendingInteraction: (taskId: string, opts?: { signal?: AbortSignal }) =>
    get<{ pending: PendingInteraction | null }>(`/api/tasks/${taskId}/interaction/pending`, opts).then(r => r.pending),
  respondToInteraction: (taskId: string, interactionId: string, body: { selectedOptionId?: string; inputValue?: string }) =>
    post<void>(`/api/tasks/${taskId}/interaction/${interactionId}/respond`, body),

  // Runtime
  getRuntime: (opts?: { signal?: AbortSignal }) => get<RuntimeInfo>('/api/runtime', opts),

  // Audit
  getAudit: (limit = 50, taskId?: string, opts?: { signal?: AbortSignal }) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (taskId) params.set('taskId', taskId)
    return get<{ entries: unknown[] }>(`/api/audit?${params}`, opts).then(r => r.entries)
  },

  // Files
  readFile: (path: string) => get<{ path: string; content: string }>(`/api/files?path=${encodeURIComponent(path)}`),

  // Conversation
  getConversation: (taskId: string, opts?: { signal?: AbortSignal }) =>
    get<{ messages: LLMMessage[] }>(`/api/tasks/${taskId}/conversation`, opts).then(r => r.messages),
}
