import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../src/interfaces/app/createApp.js'
import { loadAppConfig } from '../../src/config/appConfig.js'

function envelopeWithMcpServer(): string {
  return JSON.stringify({
    llms: {
      defaultProfile: 'fast',
      clientPolicies: {
        default: {
          openaiCompat: {
            enableThinking: true,
          },
        },
      },
      profiles: {
        fast: { model: 'fake-fast', clientPolicy: 'default' },
        writer: { model: 'fake-writer', clientPolicy: 'default' },
        reasoning: { model: 'fake-reasoning', clientPolicy: 'default' },
      },
    },
    mcp: {
      servers: {
        broken: {
          enabled: true,
          transport: {
            type: 'stdio',
            command: 'definitely-not-a-real-binary',
          },
          startupTimeoutMs: 100,
        },
      },
    },
  })
}

describe('createApp MCP wiring', () => {
  it('soft-fails broken MCP servers and still boots built-in tooling', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-mcp-app-'))
    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'fake',
      SEED_LLM_PROFILES_JSON: envelopeWithMcpServer(),
    }, { workspaceDir })

    const app = await createApp({
      baseDir: workspaceDir,
      config,
    })

    try {
      expect(app.toolRegistry.get('readFile')).toBeDefined()
      expect(app.toolRegistry.get('runCommand')).toBeDefined()
      expect(app.mcpToolExtension).not.toBeNull()
    } finally {
      await app.dispose()
    }
  })
})
