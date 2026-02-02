/**
 * @deprecated This file is deprecated. Use Application layer services instead:
 * - TaskService for createTask, listTasks, openThread
 * - PatchService for proposePatch, acceptPatch
 * - EventService for replayEvents
 * 
 * This file is kept for backward compatibility reference.
 */
import { nanoid } from 'nanoid'
import { applyUnifiedPatchToFile } from '../patch/applyUnifiedPatch.js'
import type { EventStore } from '../domain/ports/eventStore.js'
import type { DomainEvent, StoredEvent } from '../domain/events.js'
import { defaultTasksProjectionState, defaultThreadProjectionState, reduceTasksProjection, reduceThreadProjection } from './projections.js'
import { runProjection } from './projector.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'

export async function createTask(store: EventStore, title: string): Promise<{ taskId: string }> {
  const taskId = nanoid()
  store.append(taskId, [{ 
    type: 'TaskCreated', 
    payload: { 
      taskId, 
      title,
      intent: '',
      priority: 'foreground' as const,
      authorActorId: DEFAULT_USER_ACTOR_ID
    } 
  }])
  return { taskId }
}

export async function listTasks(store: EventStore) {
  return runProjection({
    store,
    name: 'tasks',
    defaultState: defaultTasksProjectionState,
    reduce: reduceTasksProjection
  })
}

export async function openThread(store: EventStore, taskId: string) {
  store.append(taskId, [{ 
    type: 'ThreadOpened', 
    payload: { taskId, authorActorId: DEFAULT_USER_ACTOR_ID } 
  }])
  return runProjection({
    store,
    name: 'threads',
    defaultState: defaultThreadProjectionState,
    reduce: reduceThreadProjection
  })
}

export async function proposePatch(store: EventStore, taskId: string, targetPath: string, patchText: string) {
  const proposalId = nanoid()
  store.append(taskId, [
    {
      type: 'PatchProposed',
      payload: { taskId, proposalId, targetPath, patchText, authorActorId: DEFAULT_USER_ACTOR_ID }
    }
  ])
  return { proposalId }
}

export async function acceptPatch(opts: {
  store: EventStore
  baseDir: string
  taskId: string
  proposalIdOrLatest: string
}): Promise<{ proposalId: string; targetPath: string; absolutePath: string }> {
  const { store, baseDir, taskId, proposalIdOrLatest } = opts
  const proposals = getPatchProposalsForTask(store, taskId)
  const proposal =
    proposalIdOrLatest === 'latest'
      ? proposals.at(-1) ?? null
      : proposals.find((p) => p.payload.proposalId === proposalIdOrLatest) ?? null

  if (!proposal) {
    throw new Error(`未找到 patch proposal：${proposalIdOrLatest}`)
  }

  const { absolutePath } = await applyUnifiedPatchToFile({
    baseDir,
    targetPath: proposal.payload.targetPath,
    patchText: proposal.payload.patchText
  })

  store.append(taskId, [
    {
      type: 'PatchApplied',
      payload: {
        taskId,
        proposalId: proposal.payload.proposalId,
        targetPath: proposal.payload.targetPath,
        patchText: proposal.payload.patchText,
        appliedAt: new Date().toISOString(),
        authorActorId: DEFAULT_USER_ACTOR_ID
      }
    }
  ])

  return { proposalId: proposal.payload.proposalId, targetPath: proposal.payload.targetPath, absolutePath }
}

export function replayEvents(store: EventStore, streamId?: string): StoredEvent[] {
  if (!streamId) return store.readAll(0)
  return store.readStream(streamId, 1)
}

function getPatchProposalsForTask(store: EventStore, taskId: string): Array<StoredEvent & { type: 'PatchProposed' }> {
  const events = store.readStream(taskId, 1)
  return events.filter((e) => e.type === 'PatchProposed') as any
}

