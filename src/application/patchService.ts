// Patch service: encapsulates patch use cases (propose, accept, reject, apply)
// Handles unified diff application with base revision checking

import { nanoid } from 'nanoid'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EventStore } from '../domain/index.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'
import { applyUnifiedPatchToFile } from '../patch/applyUnifiedPatch.js'
import { computeRevision } from './revision.js'

function tryReadText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

// ============================================================================
// Types
// ============================================================================

export type PatchProposal = {
  proposalId: string
  taskId: string
  targetPath: string
  patchText: string
  baseRevision?: string
  status: 'pending' | 'accepted' | 'rejected' | 'applied'
  authorActorId: string
  createdAt: string
}

// ============================================================================
// Patch Service
// ============================================================================

export class PatchService {
  readonly #store: EventStore
  readonly #baseDir: string
  readonly #currentActorId: string

  constructor(store: EventStore, baseDir: string, currentActorId: string = DEFAULT_USER_ACTOR_ID) {
    this.#store = store
    this.#baseDir = baseDir
    this.#currentActorId = currentActorId
  }

  /**
   * Propose a patch for a task.
   */
  proposePatch(taskId: string, targetPath: string, patchText: string, baseRevision?: string): { proposalId: string } {
    const proposalId = `patch_${nanoid(12)}`
    const inferredBaseRevision =
      baseRevision ??
      (() => {
        const text = tryReadText(resolve(this.#baseDir, targetPath))
        return text === null ? undefined : computeRevision(text)
      })()
    this.#store.append(taskId, [
      {
        type: 'PatchProposed',
        payload: {
          taskId,
          proposalId,
          targetPath,
          patchText,
          baseRevision: inferredBaseRevision,
          authorActorId: this.#currentActorId
        }
      }
    ])
    return { proposalId }
  }

  /**
   * Accept a patch proposal.
   */
  acceptPatch(taskId: string, proposalId: string): void {
    this.#store.append(taskId, [
      {
        type: 'PatchAccepted',
        payload: {
          taskId,
          proposalId,
          authorActorId: this.#currentActorId
        }
      }
    ])
  }

  /**
   * Reject a patch proposal.
   */
  rejectPatch(taskId: string, proposalId: string, reason?: string): void {
    this.#store.append(taskId, [
      {
        type: 'PatchRejected',
        payload: {
          taskId,
          proposalId,
          reason,
          authorActorId: this.#currentActorId
        }
      }
    ])
  }

  /**
   * Accept and apply a patch in one operation.
   * This is the common case for user accepting a patch.
   */
  async acceptAndApplyPatch(
    taskId: string,
    proposalIdOrLatest: string
  ): Promise<{ proposalId: string; targetPath: string; absolutePath: string }> {
    const proposals = this.#getPatchProposalsForTask(taskId)
    const proposal =
      proposalIdOrLatest === 'latest'
        ? proposals.at(-1) ?? null
        : proposals.find(p => p.proposalId === proposalIdOrLatest) ?? null

    if (!proposal) {
      throw new Error(`未找到 patch proposal：${proposalIdOrLatest}`)
    }

    if (proposal.baseRevision) {
      const currentText = tryReadText(resolve(this.#baseDir, proposal.targetPath))
      const currentRevision = currentText === null ? undefined : computeRevision(currentText)
      if (currentRevision !== proposal.baseRevision) {
        const reason = `baseRevision 不匹配：expected=${proposal.baseRevision} actual=${currentRevision ?? 'missing'}`
        this.rejectPatch(taskId, proposal.proposalId, reason)
        this.#store.append(taskId, [
          {
            type: 'PatchConflicted',
            payload: {
              taskId,
              proposalId: proposal.proposalId,
              targetPath: proposal.targetPath,
              reason,
              authorActorId: this.#currentActorId
            }
          }
        ])
        throw new Error(reason)
      }
    }

    this.acceptPatch(taskId, proposal.proposalId)

    // Apply the patch to file
    const { absolutePath, updatedText } = await applyUnifiedPatchToFile({
      baseDir: this.#baseDir,
      targetPath: proposal.targetPath,
      patchText: proposal.patchText
    })
    const newRevision = computeRevision(updatedText)

    // Record the application
    this.#store.append(taskId, [
      {
        type: 'PatchApplied',
        payload: {
          taskId,
          proposalId: proposal.proposalId,
          targetPath: proposal.targetPath,
          patchText: proposal.patchText,
          appliedAt: new Date().toISOString(),
          newRevision,
          authorActorId: this.#currentActorId
        }
      }
    ])

    return {
      proposalId: proposal.proposalId,
      targetPath: proposal.targetPath,
      absolutePath
    }
  }

  /**
   * Get all patch proposals for a task.
   */
  getProposalsForTask(taskId: string): PatchProposal[] {
    return this.#getPatchProposalsForTask(taskId)
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  #getPatchProposalsForTask(taskId: string): PatchProposal[] {
    const events = this.#store.readStream(taskId, 1)
    const proposals = new Map<string, PatchProposal>()

    for (const event of events) {
      if (event.type === 'PatchProposed') {
        proposals.set(event.payload.proposalId, {
          proposalId: event.payload.proposalId,
          taskId: event.payload.taskId,
          targetPath: event.payload.targetPath,
          patchText: event.payload.patchText,
          baseRevision: event.payload.baseRevision,
          status: 'pending',
          authorActorId: event.payload.authorActorId,
          createdAt: event.createdAt
        })
      } else if (event.type === 'PatchAccepted') {
        const p = proposals.get(event.payload.proposalId)
        if (p) p.status = 'accepted'
      } else if (event.type === 'PatchRejected') {
        const p = proposals.get(event.payload.proposalId)
        if (p) p.status = 'rejected'
      } else if (event.type === 'PatchApplied') {
        const p = proposals.get(event.payload.proposalId)
        if (p) p.status = 'applied'
      }
    }

    return Array.from(proposals.values())
  }
}
