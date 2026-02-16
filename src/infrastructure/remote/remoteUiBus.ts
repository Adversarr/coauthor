/**
 * Remote UiBus — events$ backed by WebSocket, emit() is a no-op (clients don't produce UI events).
 */

import type { UiBus, UiEvent } from '../../core/ports/uiBus.js'
import type { Subscribable } from '../../core/ports/subscribable.js'
import type { SeedWsClient } from './wsClient.js'

export class RemoteUiBus implements UiBus {
  readonly #ws: SeedWsClient

  constructor(ws: SeedWsClient) {
    this.#ws = ws
  }

  get events$(): Subscribable<UiEvent> {
    return this.#ws.uiEvents$
  }

  emit(_event: UiEvent): void {
    // No-op: UI events are produced by the master process only
  }
}
