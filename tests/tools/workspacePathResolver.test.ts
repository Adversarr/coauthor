import { describe, expect, test } from 'vitest'
import { TaskService } from '../../src/application/services/taskService.js'
import { DefaultWorkspacePathResolver } from '../../src/infrastructure/workspace/workspacePathResolver.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'
import { InMemoryEventStore } from '../helpers/inMemoryEventStore.js'

describe('DefaultWorkspacePathResolver', () => {
  test('defaults unscoped paths to private scope', async () => {
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const resolver = new DefaultWorkspacePathResolver({
      baseDir: '/workspace',
      taskService
    })
    const { taskId } = await taskService.createTask({
      title: 'Root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    const foo = await resolver.resolvePath(taskId, 'foo')
    const slashFoo = await resolver.resolvePath(taskId, '/foo')
    const nested = await resolver.resolvePath(taskId, 'foo/bar')

    expect(foo.scope).toBe('private')
    expect(foo.logicalPath).toBe('private:/foo')
    expect(foo.storePath).toBe(`private/${taskId}/foo`)

    expect(slashFoo.scope).toBe('private')
    expect(slashFoo.logicalPath).toBe('private:/foo')
    expect(slashFoo.storePath).toBe(`private/${taskId}/foo`)

    expect(nested.scope).toBe('private')
    expect(nested.logicalPath).toBe('private:/foo/bar')
    expect(nested.storePath).toBe(`private/${taskId}/foo/bar`)
  })

  test('maps explicit private/public/shared scopes', async () => {
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const resolver = new DefaultWorkspacePathResolver({
      baseDir: '/workspace',
      taskService
    })
    const { taskId: rootTaskId } = await taskService.createTask({
      title: 'Root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })
    const { taskId: childTaskId } = await taskService.createTask({
      title: 'Child',
      agentId: DEFAULT_AGENT_ACTOR_ID,
      parentTaskId: rootTaskId
    })

    const privatePath = await resolver.resolvePath(rootTaskId, 'private:/a')
    const publicPath = await resolver.resolvePath(rootTaskId, 'public:/README.md')
    const sharedPath = await resolver.resolvePath(childTaskId, 'shared:/x/y')

    expect(privatePath.storePath).toBe(`private/${rootTaskId}/a`)
    expect(publicPath.storePath).toBe('public/README.md')
    expect(sharedPath.storePath).toBe(`shared/${rootTaskId}/x/y`)
  })

  test('denies shared scope for standalone root task', async () => {
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const resolver = new DefaultWorkspacePathResolver({
      baseDir: '/workspace',
      taskService
    })
    const { taskId } = await taskService.createTask({
      title: 'Standalone root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await expect(resolver.resolvePath(taskId, 'shared:/x')).rejects.toThrow('shared:/ is not available')
  })

  test('allows shared scope for root and descendants after child exists', async () => {
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const resolver = new DefaultWorkspacePathResolver({
      baseDir: '/workspace',
      taskService
    })
    const { taskId: rootTaskId } = await taskService.createTask({
      title: 'Root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await expect(resolver.resolvePath(rootTaskId, 'shared:/x')).rejects.toThrow('shared:/ is not available')

    const { taskId: childTaskId } = await taskService.createTask({
      title: 'Child',
      agentId: DEFAULT_AGENT_ACTOR_ID,
      parentTaskId: rootTaskId
    })

    const rootShared = await resolver.resolvePath(rootTaskId, 'shared:/x')
    const childShared = await resolver.resolvePath(childTaskId, 'shared:/x')

    expect(rootShared.storePath).toBe(`shared/${rootTaskId}/x`)
    expect(childShared.storePath).toBe(`shared/${rootTaskId}/x`)
  })

  test('enforces public scope traversal guard', async () => {
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const resolver = new DefaultWorkspacePathResolver({
      baseDir: '/workspace',
      taskService
    })
    const { taskId } = await taskService.createTask({
      title: 'Root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await expect(
      resolver.resolvePath(taskId, 'public:/../private/other/file.txt')
    ).rejects.toThrow('Path must not escape scope root')

    await expect(
      resolver.resolvePath(taskId, 'public:/../shared/other/file.txt')
    ).rejects.toThrow('Path must not escape scope root')
  })

  test('isolates shared roots across unrelated task groups', async () => {
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const resolver = new DefaultWorkspacePathResolver({
      baseDir: '/workspace',
      taskService
    })
    const { taskId: rootA } = await taskService.createTask({
      title: 'Root A',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })
    await taskService.createTask({
      title: 'A child',
      agentId: DEFAULT_AGENT_ACTOR_ID,
      parentTaskId: rootA
    })

    const { taskId: rootB } = await taskService.createTask({
      title: 'Root B',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })
    await taskService.createTask({
      title: 'B child',
      agentId: DEFAULT_AGENT_ACTOR_ID,
      parentTaskId: rootB
    })

    const sharedA = await resolver.resolvePath(rootA, 'shared:/artifact.txt')
    const sharedB = await resolver.resolvePath(rootB, 'shared:/artifact.txt')

    expect(sharedA.storePath).toBe(`shared/${rootA}/artifact.txt`)
    expect(sharedB.storePath).toBe(`shared/${rootB}/artifact.txt`)
    expect(sharedA.storePath).not.toBe(sharedB.storePath)
  })
})
