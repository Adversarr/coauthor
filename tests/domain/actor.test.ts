import { describe, it, expect } from 'vitest'
import {
  createUserActor,
  createAgentActor,
  DEFAULT_USER_ACTOR_ID,
  DEFAULT_AGENT_ACTOR_ID,
  ActorSchema
} from '../../src/domain/actor.js'

describe('Actor Domain', () => {
  describe('createUserActor', () => {
    it('should create default user actor', () => {
      const actor = createUserActor({ displayName: 'Test User' })
      expect(actor).toEqual({
        id: DEFAULT_USER_ACTOR_ID,
        kind: 'human',
        displayName: 'Test User',
        capabilities: ['tool_read_file', 'tool_edit_file', 'tool_run_command', 'create_task', 'read_assets'],
        defaultAgentId: DEFAULT_AGENT_ACTOR_ID
      })
      expect(() => ActorSchema.parse(actor)).not.toThrow()
    })

    it('should create custom user actor', () => {
      const actor = createUserActor({
        id: 'u1',
        displayName: 'Custom User',
        defaultAgentId: 'a1'
      })
      expect(actor.id).toBe('u1')
      expect(actor.defaultAgentId).toBe('a1')
    })
  })

  describe('createAgentActor', () => {
    it('should create agent actor with defaults', () => {
      const actor = createAgentActor({
        id: 'agent1',
        displayName: 'Bot'
      })
      expect(actor).toEqual({
        id: 'agent1',
        kind: 'agent',
        displayName: 'Bot',
        capabilities: ['read_assets']
      })
      expect(() => ActorSchema.parse(actor)).not.toThrow()
    })

    it('should create agent with custom capabilities', () => {
      const actor = createAgentActor({
        id: 'agent1',
        displayName: 'Bot',
        capabilities: ['tool_read_file']
      })
      expect(actor.capabilities).toEqual(['tool_read_file'])
    })
  })
})
