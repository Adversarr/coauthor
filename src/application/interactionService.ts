/**
 * Application Layer - Interaction Service
 *
 * Handles UIP (Universal Interaction Protocol) events.
 * Responsible for creating interaction requests and processing responses.
 */

import { nanoid } from 'nanoid'
import type { EventStore } from '../domain/ports/eventStore.js'
import type {
  UserInteractionRequestedPayload,
  UserInteractionRespondedPayload,
  InteractionKind,
  InteractionPurpose,
  InteractionDisplay,
  InteractionOption,
  InteractionValidation
} from '../domain/events.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'

// ============================================================================
// Types
// ============================================================================

export type InteractionRequest = {
  kind: InteractionKind
  purpose: InteractionPurpose
  display: InteractionDisplay
  options?: InteractionOption[]
  validation?: InteractionValidation
}

export type InteractionResponse = {
  selectedOptionId?: string
  inputValue?: string
  comment?: string
}

// ============================================================================
// Interaction Service
// ============================================================================

export class InteractionService {
  readonly #store: EventStore
  readonly #currentActorId: string
  readonly #defaultTimeoutMs: number

  constructor(
    store: EventStore,
    currentActorId: string = DEFAULT_USER_ACTOR_ID,
    defaultTimeoutMs: number = 300000
  ) {
    this.#store = store
    this.#currentActorId = currentActorId
    this.#defaultTimeoutMs = defaultTimeoutMs
  }

  /**
   * Request an interaction from the user.
   * Emits UserInteractionRequested event and returns the interactionId.
   */
  async requestInteraction(
    taskId: string,
    request: InteractionRequest,
    authorActorId?: string
  ): Promise<{ interactionId: string }> {
    const interactionId = `ui_${nanoid(12)}`
    
    await this.#store.append(taskId, [
      {
        type: 'UserInteractionRequested',
        payload: {
          interactionId,
          taskId,
          kind: request.kind,
          purpose: request.purpose,
          display: request.display,
          options: request.options,
          validation: request.validation,
          authorActorId: authorActorId ?? this.#currentActorId
        }
      }
    ])

    return { interactionId }
  }

  /**
   * Submit a response to an interaction.
   * Emits UserInteractionResponded event.
   *
   * Validates that the interactionId matches the task's currently pending
   * interaction to prevent stale/duplicate responses from triggering
   * unintended resumes (SA-002).
   */
  async respondToInteraction(
    taskId: string,
    interactionId: string,
    response: InteractionResponse
  ): Promise<void> {
    // Validate the response targets the currently pending interaction (SA-002)
    const pending = await this.getPendingInteraction(taskId)
    if (!pending) {
      throw new Error(
        `No pending interaction for task ${taskId}. ` +
        `Response to interaction ${interactionId} rejected.`
      )
    }
    if (pending.interactionId !== interactionId) {
      throw new Error(
        `Interaction ${interactionId} is not the pending interaction for task ${taskId}. ` +
        `Currently pending: ${pending.interactionId}. Stale/duplicate response rejected.`
      )
    }

    await this.#store.append(taskId, [
      {
        type: 'UserInteractionResponded',
        payload: {
          interactionId,
          taskId,
          selectedOptionId: response.selectedOptionId,
          inputValue: response.inputValue,
          comment: response.comment,
          authorActorId: this.#currentActorId
        }
      }
    ])
  }

  /**
   * Get the pending interaction for a task (if any).
   * Returns the most recent unanswered interaction request.
   */
  async getPendingInteraction(taskId: string): Promise<UserInteractionRequestedPayload | null> {
    const events = await this.#store.readStream(taskId)
    
    // Build a set of responded interaction IDs
    const respondedIds = new Set<string>()
    for (const event of events) {
      if (event.type === 'UserInteractionResponded') {
        respondedIds.add(event.payload.interactionId)
      }
    }

    // Find the last unanswered request
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event?.type === 'UserInteractionRequested') {
        if (!respondedIds.has(event.payload.interactionId)) {
          return event.payload
        }
      }
    }

    return null
  }

  /**
   * Get the response for a specific interaction (if any).
   */
  async getInteractionResponse(
    taskId: string,
    interactionId: string
  ): Promise<UserInteractionRespondedPayload | null> {
    const events = await this.#store.readStream(taskId)
    
    for (const event of events) {
      if (
        event.type === 'UserInteractionResponded' &&
        event.payload.interactionId === interactionId
      ) {
        return event.payload
      }
    }

    return null
  }

  /**
   * Wait for a response to an interaction.
   * Polls the event store until a response is found or timeout.
   */
  async waitForResponse(
    taskId: string,
    interactionId: string,
    opts?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<UserInteractionRespondedPayload | null> {
    const timeoutMs = opts?.timeoutMs ?? this.#defaultTimeoutMs
    const pollIntervalMs = opts?.pollIntervalMs ?? 100

    const startTime = Date.now()
    
    while (timeoutMs === 0 || Date.now() - startTime < timeoutMs) {
      const response = await this.getInteractionResponse(taskId, interactionId)
      if (response) {
        return response
      }
      
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    return null
  }
}
