import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { TaskService } from '../src/application/taskService.js'
import { ContextBuilder } from '../src/application/contextBuilder.js'
import { AgentRuntime } from '../src/agents/runtime.js'
import { DefaultCoAuthorAgent } from '../src/agents/defaultAgent.js'
import { FakeLLMClient } from '../src/infra/fakeLLMClient.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

describe('AgentRuntime', () => {
  test('handleTask writes AgentPlanPosted and updates tasks projection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    store.append('t1', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't1',
          title: 'T1',
          intent: 'test intent',
          priority: 'foreground',
          agentId: DEFAULT_AGENT_ACTOR_ID,
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const contextBuilder = new ContextBuilder(dir)
    const llm = new FakeLLMClient({
      rules: [
        {
          whenIncludes: 'title: T1',
          returns: JSON.stringify({
            goal: 'Do something',
            strategy: 'Steps',
            scope: 'Unit test',
            issues: [],
            risks: [],
            questions: []
          })
        }
      ]
    })
    const agent = new DefaultCoAuthorAgent({ contextBuilder })

    const rt = new AgentRuntime({
      store,
      taskService,
      agent,
      llm,
      baseDir: dir
    })

    const res = await rt.handleTask('t1')
    expect(res.taskId).toBe('t1')

    const plan = rt.getLastPlan(res.events)
    expect(plan?.plan.goal).toBe('Do something')

    const events = store.readStream('t1', 1)

    // Verify TaskStarted was emitted
    const startedEvt = events.find((e) => e.type === 'TaskStarted')
    expect(startedEvt).toBeTruthy()
    if (startedEvt?.type === 'TaskStarted') {
      expect(startedEvt.payload.agentId).toBe(DEFAULT_AGENT_ACTOR_ID)
    }

    // Verify AgentPlanPosted was emitted
    const planEvt = events.find((e) => e.type === 'AgentPlanPosted')
    expect(planEvt).toBeTruthy()
    if (planEvt?.type === 'AgentPlanPosted') {
      expect(planEvt.payload.planId).toBe(plan?.planId)
      expect(planEvt.payload.authorActorId).toBe(DEFAULT_AGENT_ACTOR_ID)
      expect(planEvt.payload.plan.goal).toBe('Do something')
    }

    const view = taskService.getTask('t1')
    expect(view?.currentPlanId).toBe(plan?.planId)
    expect(view?.agentId).toBe(DEFAULT_AGENT_ACTOR_ID)

    rmSync(dir, { recursive: true, force: true })
  })

  test('start polls TaskCreated and automatically posts a plan for assigned tasks', async () => {
    vi.useFakeTimers()

    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const contextBuilder = new ContextBuilder(dir)
    const llm = new FakeLLMClient()
    const agent = new DefaultCoAuthorAgent({ contextBuilder })
    const rt = new AgentRuntime({
      store,
      taskService,
      agent,
      llm,
      baseDir: dir
    })

    rt.start()

    // Create a task assigned to this agent
    store.append('t2', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't2',
          title: 'T2',
          intent: '',
          priority: 'foreground',
          agentId: DEFAULT_AGENT_ACTOR_ID,
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    await vi.advanceTimersByTimeAsync(50)
    rt.stop()
    vi.useRealTimers()

    const events = store.readStream('t2', 1)
    expect(events.some((e) => e.type === 'TaskStarted')).toBe(true)
    expect(events.some((e) => e.type === 'AgentPlanPosted')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('ignores tasks assigned to other agents', async () => {
    vi.useFakeTimers()

    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const contextBuilder = new ContextBuilder(dir)
    const llm = new FakeLLMClient()
    const agent = new DefaultCoAuthorAgent({ contextBuilder })
    const rt = new AgentRuntime({
      store,
      taskService,
      agent,
      llm,
      baseDir: dir
    })

    rt.start()

    // Create a task assigned to a DIFFERENT agent
    store.append('t3', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't3',
          title: 'T3',
          intent: '',
          priority: 'foreground',
          agentId: 'other_agent_id',
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    await vi.advanceTimersByTimeAsync(50)
    rt.stop()
    vi.useRealTimers()

    const events = store.readStream('t3', 1)
    // Should only have TaskCreated, no AgentPlanPosted
    expect(events.length).toBe(1)
    expect(events[0]?.type).toBe('TaskCreated')

    rmSync(dir, { recursive: true, force: true })
  })
})
