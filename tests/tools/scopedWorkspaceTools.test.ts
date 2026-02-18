import { describe, expect, test } from 'vitest'
import { vol } from 'memfs'
import { TaskService } from '../../src/application/services/taskService.js'
import { MemFsArtifactStore } from '../../src/infrastructure/filesystem/memFsArtifactStore.js'
import { readFileTool } from '../../src/infrastructure/tools/readFile.js'
import { editFileTool } from '../../src/infrastructure/tools/editFile.js'
import { listFilesTool } from '../../src/infrastructure/tools/listFiles.js'
import { globTool } from '../../src/infrastructure/tools/globTool.js'
import { DefaultWorkspacePathResolver } from '../../src/infrastructure/workspace/workspacePathResolver.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'
import { InMemoryEventStore } from '../helpers/inMemoryEventStore.js'

describe('Scoped workspace tool behavior', () => {
  test('unscoped tool paths default to private scope, public is explicit', async () => {
    const baseDir = '/workspace'
    vol.reset()
    vol.mkdirSync(baseDir, { recursive: true })
    vol.fromJSON({ 'public/README.md': 'public-readme' }, baseDir)

    const artifactStore = new MemFsArtifactStore(baseDir)
    const eventStore = new InMemoryEventStore()
    const taskService = new TaskService(eventStore, DEFAULT_USER_ACTOR_ID)
    const workspaceResolver = new DefaultWorkspacePathResolver({ baseDir, taskService })
    const { taskId } = await taskService.createTask({
      title: 'Root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await artifactStore.mkdir(`private/${taskId}`)
    await artifactStore.writeFile(`private/${taskId}/local.txt`, 'private-content')

    const listResult = await listFilesTool.execute(
      { path: '.' },
      { taskId, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )
    expect(listResult.isError).toBe(false)
    expect((listResult.output as any).path).toBe('private:/')
    expect((listResult.output as any).content).toContain('local.txt')

    const privateReadResult = await readFileTool.execute(
      { path: 'local.txt' },
      { taskId, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )
    expect(privateReadResult.isError).toBe(false)
    expect((privateReadResult.output as any).path).toBe('private:/local.txt')
    expect((privateReadResult.output as any).content).toContain('private-content')

    const wrongScopeRead = await readFileTool.execute(
      { path: 'README.md' },
      { taskId, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )
    expect(wrongScopeRead.isError).toBe(true)

    const publicReadResult = await readFileTool.execute(
      { path: 'public:/README.md' },
      { taskId, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )
    expect(publicReadResult.isError).toBe(false)
    expect((publicReadResult.output as any).path).toBe('public:/README.md')
    expect((publicReadResult.output as any).content).toContain('public-readme')
  })

  test('shared scope is denied for standalone roots and shared across root+descendants after child creation', async () => {
    const baseDir = '/workspace'
    vol.reset()
    vol.mkdirSync(baseDir, { recursive: true })

    const artifactStore = new MemFsArtifactStore(baseDir)
    const eventStore = new InMemoryEventStore()
    const taskService = new TaskService(eventStore, DEFAULT_USER_ACTOR_ID)
    const workspaceResolver = new DefaultWorkspacePathResolver({ baseDir, taskService })

    const { taskId: rootTaskId } = await taskService.createTask({
      title: 'Root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    const standaloneSharedRead = await readFileTool.execute(
      { path: 'shared:/handoff.txt' },
      { taskId: rootTaskId, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )
    expect(standaloneSharedRead.isError).toBe(true)
    expect((standaloneSharedRead.output as any).error).toContain('shared:/ is not available')

    const { taskId: childTaskId } = await taskService.createTask({
      title: 'Child',
      agentId: DEFAULT_AGENT_ACTOR_ID,
      parentTaskId: rootTaskId
    })

    const sharedWrite = await editFileTool.execute(
      {
        path: 'shared:/handoff.txt',
        oldString: '',
        newString: 'shared-data'
      },
      { taskId: rootTaskId, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )
    expect(sharedWrite.isError).toBe(false)

    const childSharedRead = await readFileTool.execute(
      { path: 'shared:/handoff.txt' },
      { taskId: childTaskId, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )
    expect(childSharedRead.isError).toBe(false)
    expect((childSharedRead.output as any).content).toContain('shared-data')

    const { taskId: unrelatedRoot } = await taskService.createTask({
      title: 'Unrelated root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })
    await taskService.createTask({
      title: 'Unrelated child',
      agentId: DEFAULT_AGENT_ACTOR_ID,
      parentTaskId: unrelatedRoot
    })

    const unrelatedSharedRead = await readFileTool.execute(
      { path: 'shared:/handoff.txt' },
      { taskId: unrelatedRoot, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )
    expect(unrelatedSharedRead.isError).toBe(true)
    expect((unrelatedSharedRead.output as any).error).toContain('ENOENT')
  })

  test('public scope cannot access private/shared workspace internals', async () => {
    const baseDir = '/workspace'
    vol.reset()
    vol.mkdirSync(baseDir, { recursive: true })

    const artifactStore = new MemFsArtifactStore(baseDir)
    const eventStore = new InMemoryEventStore()
    const taskService = new TaskService(eventStore, DEFAULT_USER_ACTOR_ID)
    const workspaceResolver = new DefaultWorkspacePathResolver({ baseDir, taskService })
    const { taskId } = await taskService.createTask({
      title: 'Root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await artifactStore.mkdir(`private/${taskId}`)
    await artifactStore.writeFile(`private/${taskId}/secret.txt`, 'secret')

    const result = await readFileTool.execute(
      { path: `public:/../private/${taskId}/secret.txt` },
      { taskId, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('Path must not escape scope root')
  })

  test('globTool follows private-default and explicit public scope', async () => {
    const baseDir = '/workspace'
    vol.reset()
    vol.mkdirSync(baseDir, { recursive: true })
    vol.fromJSON({ 'public/README.md': 'public-readme' }, baseDir)

    const artifactStore = new MemFsArtifactStore(baseDir)
    const eventStore = new InMemoryEventStore()
    const taskService = new TaskService(eventStore, DEFAULT_USER_ACTOR_ID)
    const workspaceResolver = new DefaultWorkspacePathResolver({ baseDir, taskService })
    const { taskId } = await taskService.createTask({
      title: 'Root',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await artifactStore.mkdir(`private/${taskId}`)
    await artifactStore.writeFile(`private/${taskId}/private.md`, 'private-file')

    const privateGlob = await globTool.execute(
      { pattern: '*.md' },
      { taskId, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )
    expect(privateGlob.isError).toBe(false)
    expect((privateGlob.output as any).matches).toContain('private:/private.md')
    expect((privateGlob.output as any).matches).not.toContain('public:/README.md')

    const publicGlob = await globTool.execute(
      { pattern: 'public:/*.md' },
      { taskId, actorId: DEFAULT_AGENT_ACTOR_ID, baseDir, artifactStore, workspaceResolver }
    )
    expect(publicGlob.isError).toBe(false)
    expect((publicGlob.output as any).matches).toContain('public:/README.md')
  })
})
