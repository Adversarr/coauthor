import { describe, expect, it } from 'vitest'
import { TaskService } from '../../src/application/services/taskService.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import { DEFAULT_AGENT_ACTOR_ID } from '../helpers/actorIds.js'
import { createTodoUpdateTool } from '../../src/infrastructure/tools/todoUpdate.js'
import { InMemoryEventStore } from '../helpers/inMemoryEventStore.js'

describe('TodoUpdate tool', () => {
  async function createTaskServiceWithTask() {
    const store = new InMemoryEventStore()
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const { taskId } = await taskService.createTask({
      title: 'Todo task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })
    return { taskService, taskId }
  }

  it('returns next pending todo for a valid full-list update', async () => {
    const { taskService, taskId } = await createTaskServiceWithTask()
    const tool = createTodoUpdateTool({ taskService })

    const result = await tool.execute(
      {
        todos: [
          { title: 'Write tests', status: 'pending' },
          { title: 'Ship feature', status: 'completed' }
        ]
      },
      { taskId, actorId: DEFAULT_USER_ACTOR_ID, baseDir: '/tmp', artifactStore: {} as any }
    )

    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({
      title: 'Write tests',
      status: 'pending'
    })
  })

  it('returns exact all-complete message when all todos are completed', async () => {
    const { taskService, taskId } = await createTaskServiceWithTask()
    const tool = createTodoUpdateTool({ taskService })

    const result = await tool.execute(
      {
        todos: [
          { title: 'One', status: 'completed' },
          { title: 'Two', status: 'completed' }
        ]
      },
      { taskId, actorId: DEFAULT_USER_ACTOR_ID, baseDir: '/tmp', artifactStore: {} as any }
    )

    expect(result.isError).toBe(false)
    expect(result.output).toBe('All todo complete')
  })

  it('returns exact all-complete message for empty full-list updates', async () => {
    const { taskService, taskId } = await createTaskServiceWithTask()
    const tool = createTodoUpdateTool({ taskService })

    const result = await tool.execute(
      { todos: [] },
      { taskId, actorId: DEFAULT_USER_ACTOR_ID, baseDir: '/tmp', artifactStore: {} as any }
    )

    expect(result.isError).toBe(false)
    expect(result.output).toBe('All todo complete')
  })

  it('rejects todos with missing or blank title', async () => {
    const { taskService, taskId } = await createTaskServiceWithTask()
    const tool = createTodoUpdateTool({ taskService })

    const result = await tool.execute(
      {
        todos: [{ title: '   ' }]
      },
      { taskId, actorId: DEFAULT_USER_ACTOR_ID, baseDir: '/tmp', artifactStore: {} as any }
    )

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      error: expect.stringContaining('title cannot be empty')
    })
  })

  it('derives IDs and resolves duplicate IDs deterministically', async () => {
    const { taskService, taskId } = await createTaskServiceWithTask()
    const tool = createTodoUpdateTool({ taskService })

    const result = await tool.execute(
      {
        todos: [
          { title: 'Implement API' },
          { title: 'Implement API' },
          { id: 'shared-id', title: 'A' },
          { id: 'shared-id', title: 'B' }
        ]
      },
      { taskId, actorId: DEFAULT_USER_ACTOR_ID, baseDir: '/tmp', artifactStore: {} as any }
    )

    expect(result.isError).toBe(false)

    const task = await taskService.getTask(taskId)
    expect(task?.todos?.map((todo) => todo.id)).toEqual([
      'todo-implement-api-1',
      'todo-implement-api-2',
      'shared-id',
      'shared-id-2'
    ])
  })
})
