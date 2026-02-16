/**
 * createRemoteApp — builds an App wired with remote adapters for client mode.
 *
 * The returned App has the same shape as a local App, so the TUI code works unchanged.
 * Services that need the master process (RuntimeManager, conversationStore, etc.)
 * are replaced with remote stubs that delegate to HTTP/WS.
 */

import { resolve } from 'node:path'
import type { App } from './createApp.js'
import type { TaskView, TasksProjectionState, CreateTaskOptions } from '../../application/services/taskService.js'
import type { InteractionResponse } from '../../application/services/interactionService.js'
import type { StoredEvent, UserInteractionRequestedPayload } from '../../core/events/events.js'
import type { StoredAuditEntry } from '../../core/ports/auditLog.js'
import { SeedWsClient } from '../../infrastructure/remote/wsClient.js'
import { RemoteHttpClient } from '../../infrastructure/remote/httpClient.js'
import { RemoteEventStore } from '../../infrastructure/remote/remoteEventStore.js'
import { RemoteUiBus } from '../../infrastructure/remote/remoteUiBus.js'

// ============================================================================
// Remote Service Adapters
// ============================================================================

/** TaskService adapter: delegates all operations to HTTP API. */
class RemoteTaskService {
  readonly #http: RemoteHttpClient
  #defaultAgentId: string

  constructor(http: RemoteHttpClient, defaultAgentId: string) {
    this.#http = http
    this.#defaultAgentId = defaultAgentId
  }

  async createTask(opts: CreateTaskOptions): Promise<{ taskId: string }> {
    return this.#http.post('/api/tasks', { ...opts, agentId: opts.agentId ?? this.#defaultAgentId })
  }

  async listTasks(): Promise<TasksProjectionState> {
    return this.#http.get('/api/tasks')
  }

  async getTask(taskId: string): Promise<TaskView | null> {
    try {
      return await this.#http.get(`/api/tasks/${taskId}`)
    } catch {
      return null
    }
  }

  async cancelTask(taskId: string, reason?: string): Promise<void> {
    await this.#http.post(`/api/tasks/${taskId}/cancel`, { reason })
  }

  async pauseTask(taskId: string, reason?: string): Promise<void> {
    await this.#http.post(`/api/tasks/${taskId}/pause`, { reason })
  }

  async resumeTask(taskId: string, reason?: string): Promise<void> {
    await this.#http.post(`/api/tasks/${taskId}/resume`, { reason })
  }

  async addInstruction(taskId: string, instruction: string): Promise<void> {
    await this.#http.post(`/api/tasks/${taskId}/instruction`, { instruction })
  }

  canTransition(currentStatus: string, _eventType: string): boolean {
    // Client trusts server for validation — always return true locally, server will reject invalid transitions
    return !['failed', 'canceled'].includes(currentStatus)
  }
}

/** InteractionService adapter: delegates to HTTP API. */
class RemoteInteractionService {
  readonly #http: RemoteHttpClient

  constructor(http: RemoteHttpClient) {
    this.#http = http
  }

  async getPendingInteraction(taskId: string): Promise<UserInteractionRequestedPayload | null> {
    const { pending } = await this.#http.get<{ pending: UserInteractionRequestedPayload | null }>(
      `/api/tasks/${taskId}/interaction/pending`,
    )
    return pending
  }

  async respondToInteraction(taskId: string, interactionId: string, response: InteractionResponse): Promise<void> {
    await this.#http.post(`/api/tasks/${taskId}/interaction/${interactionId}/respond`, response)
  }
}

/** EventService adapter: delegates to HTTP API. */
class RemoteEventService {
  readonly #http: RemoteHttpClient

  constructor(http: RemoteHttpClient) {
    this.#http = http
  }

  async replayEvents(streamId?: string): Promise<StoredEvent[]> {
    if (streamId) {
      const { events } = await this.#http.get<{ events: StoredEvent[] }>(`/api/tasks/${streamId}/events`)
      return events
    }
    const { events } = await this.#http.get<{ events: StoredEvent[] }>('/api/events')
    return events
  }

  async getEventById(id: number): Promise<StoredEvent | null> {
    try {
      return await this.#http.get(`/api/events/${id}`)
    } catch {
      return null
    }
  }

  async getEventsAfter(fromIdExclusive: number): Promise<StoredEvent[]> {
    const { events } = await this.#http.get<{ events: StoredEvent[] }>(`/api/events?after=${fromIdExclusive}`)
    return events
  }
}

/** AuditService adapter: delegates to HTTP API. */
class RemoteAuditService {
  readonly #http: RemoteHttpClient

  constructor(http: RemoteHttpClient) {
    this.#http = http
  }

  async getRecentEntries(taskId?: string, limit?: number): Promise<StoredAuditEntry[]> {
    const params = new URLSearchParams()
    if (taskId) params.set('taskId', taskId)
    if (limit) params.set('limit', String(limit))
    const { entries } = await this.#http.get<{ entries: StoredAuditEntry[] }>(
      `/api/audit?${params.toString()}`,
    )
    return entries
  }
}

/** RuntimeManager stub for client mode: start/stop are no-ops; profile/streaming delegate to HTTP. */
class RemoteRuntimeManager {
  readonly #http: RemoteHttpClient
  readonly #agents: Map<string, { id: string; displayName: string; description: string }>
  #defaultAgentId: string
  #streamingEnabled: boolean

  constructor(http: RemoteHttpClient, runtime: { defaultAgentId: string; streamingEnabled: boolean; agents: Array<{ id: string; displayName: string; description: string }> }) {
    this.#http = http
    this.#defaultAgentId = runtime.defaultAgentId
    this.#streamingEnabled = runtime.streamingEnabled
    this.#agents = new Map(runtime.agents.map((a) => [a.id, a]))
  }

  get defaultAgentId(): string { return this.#defaultAgentId }
  set defaultAgentId(id: string) { this.#defaultAgentId = id }

  get agents(): ReadonlyMap<string, { id: string; displayName: string; description: string }> {
    return this.#agents
  }

  get streamingEnabled(): boolean { return this.#streamingEnabled }
  set streamingEnabled(val: boolean) {
    this.#streamingEnabled = val
    this.#http.post('/api/runtime/streaming', { enabled: val }).catch(() => {})
  }

  setProfileOverride(taskId: string, profile: string): void {
    if (taskId === '*') {
      this.#http.post('/api/runtime/profile', { profile }).catch(() => {})
    }
  }

  getProfileOverride(_taskId: string): string | undefined { return undefined }
  clearProfileOverride(_taskId: string): void {}

  registerAgent(): void {}
  start(): void {}
  stop(): void {}
  async waitForIdle(): Promise<void> {}
  get isRunning(): boolean { return true }
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateRemoteAppOptions {
  baseDir: string
  port: number
  token: string
}

export async function createRemoteApp(opts: CreateRemoteAppOptions): Promise<App> {
  const baseDir = resolve(opts.baseDir)
  const http = new RemoteHttpClient(opts.port, opts.token)
  const ws = new SeedWsClient({ port: opts.port, token: opts.token })

  // Fetch runtime info
  const runtime = await http.get<{
    defaultAgentId: string
    streamingEnabled: boolean
    agents: Array<{ id: string; displayName: string; description: string }>
  }>('/api/runtime')

  // Build remote adapters
  const store = new RemoteEventStore(http, ws)
  const uiBus = new RemoteUiBus(ws)
  const taskService = new RemoteTaskService(http, runtime.defaultAgentId) as unknown as App['taskService']
  const eventService = new RemoteEventService(http) as unknown as App['eventService']
  const interactionService = new RemoteInteractionService(http) as unknown as App['interactionService']
  const auditService = new RemoteAuditService(http) as unknown as App['auditService']
  const runtimeManager = new RemoteRuntimeManager(http, runtime) as unknown as App['runtimeManager']

  // Connect WebSocket
  ws.connect()

  // Placeholder stubs for fields that client mode doesn't use
  const noop = () => { throw new Error('Not available in client mode') }
  const noopAsync = async () => { throw new Error('Not available in client mode') }

  return {
    baseDir,
    storePath: '',
    auditLogPath: '',
    conversationsPath: '',
    store,
    artifactStore: { readFile: noopAsync, writeFile: noopAsync, exists: noopAsync, listDir: noopAsync, glob: noopAsync, stat: noopAsync } as unknown as App['artifactStore'],
    auditLog: { entries$: { subscribe: () => ({ unsubscribe: noop }) }, append: noopAsync, ensureSchema: noopAsync, readByTask: noopAsync, readAll: noopAsync } as unknown as App['auditLog'],
    conversationStore: { append: noopAsync, getMessages: noopAsync, truncate: noopAsync, clear: noopAsync, ensureSchema: noopAsync } as unknown as App['conversationStore'],
    telemetry: { emit: noop } as unknown as App['telemetry'],
    toolRegistry: { get: noop, list: () => [], listByGroups: () => [] } as unknown as App['toolRegistry'],
    toolExecutor: { execute: noopAsync } as unknown as App['toolExecutor'],
    llm: { complete: noopAsync, stream: noopAsync } as unknown as App['llm'],
    uiBus,
    taskService,
    eventService,
    interactionService,
    auditService,
    contextBuilder: { build: noopAsync } as unknown as App['contextBuilder'],
    runtimeManager,
  }
}
