/**
 * HTTP API client for the CoAuthor backend.
 * All methods throw on non-ok responses.
 */

import type { TaskView, StoredEvent, CreateTaskResponse, PendingInteraction, HealthResponse } from '@/types'

const BASE = '' // same origin (Vite proxy in dev, served directly in prod)

function authHeaders(): HeadersInit {
  const token = sessionStorage.getItem('coauthor-token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`POST ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

// ── Public API ─────────────────────────────────────────────────────────

export const api = {
  health: () => get<HealthResponse>('/api/health'),

  // Tasks
  listTasks: () => get<{ tasks: TaskView[] }>('/api/tasks').then(r => r.tasks),
  getTask: (id: string) => get<TaskView>(`/api/tasks/${id}`),
  createTask: (body: { title: string; intent?: string; priority?: string; agentId?: string }) =>
    post<CreateTaskResponse>('/api/tasks', body),
  cancelTask: (id: string, reason?: string) => post<void>(`/api/tasks/${id}/cancel`, { reason }),
  pauseTask: (id: string) => post<void>(`/api/tasks/${id}/pause`),
  resumeTask: (id: string) => post<void>(`/api/tasks/${id}/resume`),
  addInstruction: (id: string, instruction: string) =>
    post<void>(`/api/tasks/${id}/instruction`, { instruction }),

  // Events
  getEvents: (after = 0, streamId?: string) => {
    const params = new URLSearchParams({ after: String(after) })
    if (streamId) params.set('streamId', streamId)
    return get<{ events: StoredEvent[] }>(`/api/events?${params}`).then(r => r.events)
  },

  // Interactions
  getPendingInteraction: (taskId: string) =>
    get<{ pending: PendingInteraction | null }>(`/api/tasks/${taskId}/interaction/pending`).then(r => r.pending),
  respondToInteraction: (taskId: string, interactionId: string, body: { selectedOptionId?: string; inputValue?: string }) =>
    post<void>(`/api/tasks/${taskId}/interaction/${interactionId}/respond`, body),

  // Runtime
  getRuntime: () => get<{
    agents: Array<{ id: string; displayName: string; description: string }>
    defaultAgentId: string
    streamingEnabled: boolean
  }>('/api/runtime'),

  // Audit
  getAudit: (limit = 50, taskId?: string) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (taskId) params.set('taskId', taskId)
    return get<{ entries: unknown[] }>(`/api/audit?${params}`).then(r => r.entries)
  },

  // Files
  readFile: (path: string) => get<{ path: string; content: string }>(`/api/files?path=${encodeURIComponent(path)}`),
}
