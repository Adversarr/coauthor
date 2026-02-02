import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { TaskService } from '../src/application/taskService.js'
import { ContextBuilder } from '../src/application/contextBuilder.js'
import { AgentRuntime } from '../src/agents/runtime.js'
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

    const rt = new AgentRuntime({
      store,
      taskService,
      contextBuilder,
      llm,
      agentActorId: DEFAULT_AGENT_ACTOR_ID
    })

    const res = await rt.handleTask('t1')
    expect(res.taskId).toBe('t1')
    expect(res.plan.goal).toBe('Do something')

    const events = store.readStream('t1', 1)
    const planEvt = events.find((e) => e.type === 'AgentPlanPosted')
    expect(planEvt).toBeTruthy()
    if (planEvt?.type === 'AgentPlanPosted') {
      expect(planEvt.payload.planId).toBe(res.planId)
      expect(planEvt.payload.authorActorId).toBe(DEFAULT_AGENT_ACTOR_ID)
      expect(planEvt.payload.plan.goal).toBe('Do something')
    }

    const view = taskService.getTask('t1')
    expect(view?.currentPlanId).toBe(res.planId)

    rmSync(dir, { recursive: true, force: true })
  })
})

