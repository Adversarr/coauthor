import type { StoredEvent } from '../domain/events.js'
import type { EventStore } from '../domain/ports/eventStore.js'

// Projection reducer: fold event into state
export type ProjectionReducer<TState> = (state: TState, event: StoredEvent) => TState

// Run projection: load cursor → read events → fold → save cursor
export function runProjection<TState>(opts: {
  store: EventStore
  name: string
  defaultState: TState
  reduce: ProjectionReducer<TState>
}): TState {
  const { store, name, defaultState, reduce } = opts
  const { cursorEventId, state } = store.getProjection(name, defaultState)
  const events = store.readAll(cursorEventId)

  if (events.length === 0) return state

  let nextState = state
  for (const event of events) {
    nextState = reduce(nextState, event)
  }

  const lastEventId = events[events.length - 1]?.id ?? cursorEventId
  store.saveProjection(name, lastEventId, nextState)
  return nextState
}
