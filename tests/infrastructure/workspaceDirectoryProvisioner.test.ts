import { access, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { TaskService } from '../../src/application/services/taskService.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'
import { WorkspaceDirectoryProvisioner } from '../../src/infrastructure/workspace/workspaceDirectoryProvisioner.js'
import { DefaultWorkspacePathResolver } from '../../src/infrastructure/workspace/workspacePathResolver.js'
import { InMemoryEventStore } from '../helpers/inMemoryEventStore.js'

async function waitForPath(path: string): Promise<void> {
  const maxAttempts = 40
  const delayMs = 10

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw new Error(`Path did not appear in time: ${path}`)
}

describe('WorkspaceDirectoryProvisioner', () => {
  test('creates private workspace root when task starts', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'seed-workspace-private-'))
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const resolver = new DefaultWorkspacePathResolver({ baseDir, taskService })
    const provisioner = new WorkspaceDirectoryProvisioner({ store, workspaceResolver: resolver })
    provisioner.start()

    try {
      const { taskId } = await taskService.createTask({
        title: 'Root task',
        agentId: DEFAULT_AGENT_ACTOR_ID
      })
      await store.append(taskId, [{
        type: 'TaskStarted',
        payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
      }])

      await waitForPath(join(baseDir, 'private', taskId))
    } finally {
      provisioner.stop()
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  test('creates shared workspace root when first child task is created', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'seed-workspace-shared-'))
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const resolver = new DefaultWorkspacePathResolver({ baseDir, taskService })
    const provisioner = new WorkspaceDirectoryProvisioner({ store, workspaceResolver: resolver })
    provisioner.start()

    try {
      const { taskId: rootTaskId } = await taskService.createTask({
        title: 'Root task',
        agentId: DEFAULT_AGENT_ACTOR_ID
      })
      await taskService.createTask({
        title: 'Child task',
        agentId: DEFAULT_AGENT_ACTOR_ID,
        parentTaskId: rootTaskId
      })

      await waitForPath(join(baseDir, 'shared', rootTaskId))
    } finally {
      provisioner.stop()
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  test('directory provisioning is idempotent across repeated relevant events', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'seed-workspace-idempotent-'))
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const resolver = new DefaultWorkspacePathResolver({ baseDir, taskService })
    const provisioner = new WorkspaceDirectoryProvisioner({ store, workspaceResolver: resolver })
    provisioner.start()

    try {
      const { taskId: rootTaskId } = await taskService.createTask({
        title: 'Root task',
        agentId: DEFAULT_AGENT_ACTOR_ID
      })
      await store.append(rootTaskId, [{
        type: 'TaskStarted',
        payload: { taskId: rootTaskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
      }])
      await store.append(rootTaskId, [{
        type: 'TaskStarted',
        payload: { taskId: rootTaskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
      }])

      await taskService.createTask({
        title: 'Child A',
        agentId: DEFAULT_AGENT_ACTOR_ID,
        parentTaskId: rootTaskId
      })
      await taskService.createTask({
        title: 'Child B',
        agentId: DEFAULT_AGENT_ACTOR_ID,
        parentTaskId: rootTaskId
      })

      await waitForPath(join(baseDir, 'private', rootTaskId))
      await waitForPath(join(baseDir, 'shared', rootTaskId))
    } finally {
      provisioner.stop()
      await rm(baseDir, { recursive: true, force: true })
    }
  })
})
