
import { describe, expect, test } from 'vitest'
import { TaskService } from '../src/application/taskService.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'
import { EventStore, DomainEvent, StoredEvent } from '../src/domain/index.js'
import { Subject } from 'rxjs'

// Simple InMemory EventStore for testing
class InMemoryEventStore implements EventStore {
  private events: StoredEvent[] = []
  public events$ = new Subject<StoredEvent>()

  ensureSchema() {}
  
  append(streamId: string, events: DomainEvent[]): StoredEvent[] {
    const currentStreamEvents = this.events.filter(ev => ev.streamId === streamId)
    const newStoredEvents = events.map((e, i) => ({
      id: this.events.length + i + 1,
      streamId,
      seq: currentStreamEvents.length + i + 1,
      ...e,
      createdAt: new Date().toISOString()
    })) as StoredEvent[]
    this.events.push(...newStoredEvents)
    newStoredEvents.forEach(e => this.events$.next(e))
    return newStoredEvents
  }
  
  readStream(streamId: string): StoredEvent[] {
    return this.events.filter(e => e.streamId === streamId)
  }

  readAll(fromIdExclusive?: number): StoredEvent[] {
     const startId = fromIdExclusive ?? 0
     return this.events.filter(e => e.id > startId)
  }

  readById(id: number): StoredEvent | null {
      return this.events.find(e => e.id === id) || null
  }
  
  getProjection<TState>(name: string, defaultState: TState): { cursorEventId: number, state: TState } {
    return { cursorEventId: 0, state: defaultState }
  }

  saveProjection() {}
}

describe('TaskService State Transitions', () => {
  const setup = () => {
    const store = new InMemoryEventStore()
    const service = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    return { store, service }
  }

  const createTask = (store: InMemoryEventStore, taskId: string) => {
    store.append(taskId, [{
      type: 'TaskCreated',
      payload: { taskId, title: 'Test Task', intent: 'test', priority: 'normal', agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
  }

  test('allows valid transitions', () => {
    const { store, service } = setup()
    const taskId = 't1'
    createTask(store, taskId)

    // open -> in_progress (TaskStarted)
    store.append(taskId, [{
      type: 'TaskStarted',
      payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])
    expect(service.getTask(taskId)?.status).toBe('in_progress')

    // in_progress -> awaiting_user (UserInteractionRequested)
    store.append(taskId, [{
      type: 'UserInteractionRequested',
      payload: { 
        taskId, 
        interactionId: 'i1', 
        kind: 'Confirm', 
        purpose: 'generic', 
        display: { title: 'confirm?' }, 
        options: [], 
        validation: {}, 
        authorActorId: DEFAULT_AGENT_ACTOR_ID 
      }
    }])
    expect(service.getTask(taskId)?.status).toBe('awaiting_user')

    // awaiting_user -> in_progress (UserInteractionResponded)
    store.append(taskId, [{
      type: 'UserInteractionResponded',
      payload: { taskId, interactionId: 'i1', selectedOptionId: 'ok', authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
    expect(service.getTask(taskId)?.status).toBe('in_progress')

    // in_progress -> done (TaskCompleted)
    store.append(taskId, [{
      type: 'TaskCompleted',
      payload: { taskId, summary: 'done', authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])
    expect(service.getTask(taskId)?.status).toBe('done')

    // done -> in_progress (TaskInstructionAdded - Re-activation)
    store.append(taskId, [{
      type: 'TaskInstructionAdded',
      payload: { taskId, instruction: 'more work', authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
    expect(service.getTask(taskId)?.status).toBe('in_progress')
  })

  test('prevents invalid transitions', () => {
    const { store, service } = setup()
    const taskId = 't2'
    createTask(store, taskId)

    // Move to canceled
    store.append(taskId, [{
        type: 'TaskStarted',
        payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])
    store.append(taskId, [{
      type: 'TaskCanceled',
      payload: { taskId, reason: 'cancel', authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
    expect(service.getTask(taskId)?.status).toBe('canceled')

    // canceled -> in_progress (TaskResumed) - Should Fail/Ignore
    store.append(taskId, [{
      type: 'TaskResumed',
      payload: { taskId, authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
    // Should stay canceled
    expect(service.getTask(taskId)?.status).toBe('canceled') 
  })

  test('prevents bypassing interaction response', () => {
    const { store, service } = setup()
    const taskId = 't3'
    createTask(store, taskId)

    // Move to awaiting_user
    store.append(taskId, [{
        type: 'TaskStarted',
        payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])
    store.append(taskId, [{
      type: 'UserInteractionRequested',
      payload: { 
        taskId, 
        interactionId: 'i2', 
        kind: 'Confirm', 
        purpose: 'generic', 
        display: { title: 'confirm?' }, 
        options: [], 
        validation: {}, 
        authorActorId: DEFAULT_AGENT_ACTOR_ID 
      }
    }])
    expect(service.getTask(taskId)?.status).toBe('awaiting_user')

    // awaiting_user -> in_progress (TaskResumed) - Should Fail/Ignore
    // User should respond, not just resume
    store.append(taskId, [{
      type: 'TaskResumed',
      payload: { taskId, authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
    expect(service.getTask(taskId)?.status).toBe('awaiting_user')
  })
  
  test('TaskInstructionAdded overrides awaiting_user', () => {
      const { store, service } = setup()
      const taskId = 't4'
      createTask(store, taskId)
  
      // Move to awaiting_user
      store.append(taskId, [{
          type: 'TaskStarted',
          payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
      }])
      store.append(taskId, [{
        type: 'UserInteractionRequested',
        payload: { 
            taskId, 
            interactionId: 'i3', 
            kind: 'Confirm', 
            purpose: 'generic', 
            display: { title: 'confirm?' }, 
            options: [], 
            validation: {}, 
            authorActorId: DEFAULT_AGENT_ACTOR_ID 
        }
      }])
      
      // awaiting_user -> in_progress (TaskInstructionAdded)
      store.append(taskId, [{
        type: 'TaskInstructionAdded',
        payload: { taskId, instruction: 'nevermind do this', authorActorId: DEFAULT_USER_ACTOR_ID }
      }])
      expect(service.getTask(taskId)?.status).toBe('in_progress')
  })
})

describe('TaskService Command Validation', () => {
  const setup = () => {
    const store = new InMemoryEventStore()
    const service = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    return { store, service }
  }

  const createTask = (service: TaskService) => {
    return service.createTask({
      title: 'Test Task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    }).taskId
  }

  test('throws when cancelling a task that cannot be canceled', () => {
    const { store, service } = setup()
    const taskId = createTask(service)

    // open -> canceled (Valid)
    service.cancelTask(taskId)
    expect(service.getTask(taskId)?.status).toBe('canceled')

    // canceled -> canceled (Invalid? Actually TaskCanceled is not in allowed transitions for canceled)
    // canTransition('canceled', 'TaskCanceled') -> false
    expect(() => service.cancelTask(taskId)).toThrow(/Invalid transition/)
  })

  test('throws when pausing a task that is not in progress', () => {
    const { store, service } = setup()
    const taskId = createTask(service)

    // open -> paused (Invalid, must be in_progress?)
    // canTransition('open', 'TaskPaused') -> false
    expect(() => service.pauseTask(taskId)).toThrow(/Invalid transition/)
  })

  test('throws when resuming a task that is not paused', () => {
    const { store, service } = setup()
    const taskId = createTask(service)

    // open -> resumed (Invalid)
    expect(() => service.resumeTask(taskId)).toThrow(/Invalid transition/)
  })

  test('throws when adding instruction to task that forbids it (none currently forbid it)', () => {
    const { store, service } = setup()
    const taskId = createTask(service)
    
    // TaskInstructionAdded is always allowed
    service.addInstruction(taskId, 'inst')
    expect(service.getTask(taskId)?.status).toBe('in_progress') // open -> in_progress implicit?
    // Wait, TaskInstructionAdded returns true in canTransition.
    // And reducer sets status to 'in_progress'.
    // So this should work.
    
    service.cancelTask(taskId)
    expect(service.getTask(taskId)?.status).toBe('canceled')
    
    // canceled -> in_progress (via TaskInstructionAdded)
    service.addInstruction(taskId, 'wake up')
    expect(service.getTask(taskId)?.status).toBe('in_progress')
  })
})
