/**
 * Application Layer - Patch Service
 *
 * Encapsulates patch-related use cases.
 */

import { nanoid } from 'nanoid'
import type { EventStore, StoredEvent } from '../domain/index.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'
import { applyUnifiedPatchToFile } from '../patch/applyUnifiedPatch.js'

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
    this.#store.append(taskId, [
      {
        type: 'PatchProposed',
        payload: {
          taskId,
          proposalId,
          targetPath,
          patchText,
          baseRevision,
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

    // Accept the patch
    this.acceptPatch(taskId, proposal.proposalId)

    // Apply the patch to file
    const { absolutePath } = await applyUnifiedPatchToFile({
      baseDir: this.#baseDir,
      targetPath: proposal.targetPath,
      patchText: proposal.patchText
    })

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
