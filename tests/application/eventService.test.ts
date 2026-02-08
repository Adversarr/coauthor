import { describe, it, expect, vi } from 'vitest'
import { EventService } from '../../src/application/eventService.js'
import type { EventStore, StoredEvent } from '../../src/domain/index.js'

describe('EventService', () => {
  const mockEvents: StoredEvent[] = [
    { id: 1, streamId: 's1', type: 'TaskCreated', payload: {}, createdAt: new Date(), authorActorId: 'user', seq: 1 },
    { id: 2, streamId: 's1', type: 'TaskStarted', payload: {}, createdAt: new Date(), authorActorId: 'agent', seq: 2 },
    { id: 3, streamId: 's2', type: 'TaskCreated', payload: {}, createdAt: new Date(), authorActorId: 'user', seq: 1 }
  ]

  const mockStore = {
    readAll: vi.fn(),
    readStream: vi.fn(),
    readById: vi.fn(),
    append: vi.fn(),
    ensureSchema: vi.fn()
  } as unknown as EventStore

  it('should replay all events', async () => {
    vi.mocked(mockStore.readAll).mockResolvedValue(mockEvents)
    const service = new EventService(mockStore)

    const events = await service.replayEvents()
    
    expect(mockStore.readAll).toHaveBeenCalledWith(0)
    expect(events).toEqual(mockEvents)
  })

  it('should replay stream events', async () => {
    const streamEvents = mockEvents.filter(e => e.streamId === 's1')
    vi.mocked(mockStore.readStream).mockResolvedValue(streamEvents)
    const service = new EventService(mockStore)

    const events = await service.replayEvents('s1')

    expect(mockStore.readStream).toHaveBeenCalledWith('s1', 1)
    expect(events).toEqual(streamEvents)
  })

  it('should get event by id', async () => {
    vi.mocked(mockStore.readById).mockResolvedValue(mockEvents[0])
    const service = new EventService(mockStore)

    const event = await service.getEventById(1)

    expect(mockStore.readById).toHaveBeenCalledWith(1)
    expect(event).toEqual(mockEvents[0])
  })

  it('should get events after id', async () => {
    const afterEvents = mockEvents.slice(1)
    vi.mocked(mockStore.readAll).mockResolvedValue(afterEvents)
    const service = new EventService(mockStore)

    const events = await service.getEventsAfter(1)

    expect(mockStore.readAll).toHaveBeenCalledWith(1)
    expect(events).toEqual(afterEvents)
  })
})
