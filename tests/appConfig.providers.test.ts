import { describe, expect, it } from 'vitest'
import { loadAppConfig } from '../src/config/appConfig.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function toJson(value: unknown): string {
  return JSON.stringify(value)
}

describe('loadAppConfig profile catalog parsing', () => {
  it('parses built-ins and custom profiles from SEED_LLM_PROFILES_JSON', () => {
    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson({
        defaultProfile: 'research_web',
        clientPolicies: {
          default: {
            openaiCompat: {
              enableThinking: true,
            },
          },
          web: {
            openaiCompat: {
              enableThinking: true,
            },
          },
        },
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'default' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
          reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
          research_web: { model: 'm-web', clientPolicy: 'web' },
        },
      }),
    })

    expect(config.llm.provider).toBe('openai')
    expect(config.agent.defaultProfile).toBe('research_web')
    expect(config.llm.profiles.profiles.research_web).toEqual({
      model: 'm-web',
      clientPolicy: 'web',
    })
  })

  it('fails when required builtin profile is missing', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson({
        defaultProfile: 'fast',
        clientPolicies: {
          default: {},
        },
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'default' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
        },
      }),
    })).toThrow(/missing required builtin profile "reasoning"/)
  })

  it('fails when a profile references unknown clientPolicy', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson({
        defaultProfile: 'fast',
        clientPolicies: {
          default: {},
        },
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'unknown' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
          reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
        },
      }),
    })).toThrow(/references unknown client policy "unknown"/)
  })

  it('fails when provider-specific knobs do not match selected provider', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson({
        defaultProfile: 'fast',
        clientPolicies: {
          default: {
            provider: {
              bailian: {
                thinkingBudget: 64,
              },
            },
          },
        },
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'default' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
          reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
        },
      }),
    })).toThrow(/active provider is "openai"/)
  })

  it('fails when removed openaiCompat.webSearch field is present', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson({
        defaultProfile: 'fast',
        clientPolicies: {
          default: {
            openaiCompat: {
              enableThinking: true,
              webSearch: {
                enabled: true,
              },
            },
          },
        },
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'default' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
          reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
        },
      }),
    })).toThrow(/openaiCompat.*webSearch/)
  })

  it('fails when removed provider.bailian.forcedSearch field is present', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'bailian',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson({
        defaultProfile: 'fast',
        clientPolicies: {
          default: {
            provider: {
              bailian: {
                forcedSearch: true,
              },
            },
          },
        },
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'default' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
          reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
        },
      }),
    })).toThrow(/bailian.*forcedSearch/)
  })

  it('fails when removed provider.bailian.searchStrategy field is present', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'bailian',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson({
        defaultProfile: 'fast',
        clientPolicies: {
          default: {
            provider: {
              bailian: {
                searchStrategy: 'max',
              },
            },
          },
        },
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'default' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
          reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
        },
      }),
    })).toThrow(/bailian.*searchStrategy/)
  })

  it('loads profile catalog from a relative file path resolved against workspaceDir', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-config-'))
    writeFileSync(join(workspaceDir, 'profiles.json'), toJson({
      defaultProfile: 'fast',
      clientPolicies: {
        default: {
          openaiCompat: {
            enableThinking: true,
          },
        },
      },
      profiles: {
        fast: { model: 'm-fast', clientPolicy: 'default' },
        writer: { model: 'm-writer', clientPolicy: 'default' },
        reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
      },
    }))

    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: 'profiles.json',
    }, { workspaceDir })

    expect(config.llm.profiles.profiles.fast.model).toBe('m-fast')
  })

  it('loads profile catalog from an absolute file path', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-config-'))
    const absoluteProfilePath = join(workspaceDir, 'profiles-abs.json')
    writeFileSync(absoluteProfilePath, toJson({
      defaultProfile: 'fast',
      clientPolicies: {
        default: {
          openaiCompat: {
            enableThinking: false,
          },
        },
      },
      profiles: {
        fast: { model: 'm-fast-abs', clientPolicy: 'default' },
        writer: { model: 'm-writer-abs', clientPolicy: 'default' },
        reasoning: { model: 'm-reasoning-abs', clientPolicy: 'default' },
      },
    }))

    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: absoluteProfilePath,
    })

    expect(config.llm.profiles.profiles.fast.model).toBe('m-fast-abs')
  })

  it('supports inline JSON with leading/trailing whitespace', () => {
    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: ` \n ${toJson({
        defaultProfile: 'fast',
        clientPolicies: {
          default: {
            openaiCompat: {
              enableThinking: true,
            },
          },
        },
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'default' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
          reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
        },
      })} \n `,
    })

    expect(config.llm.profiles.defaultProfile).toBe('fast')
  })

  it('fails with a clear error when profile file path is unreadable', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-config-'))
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: 'missing-profiles.json',
    }, { workspaceDir })).toThrow(/path is unreadable/)
  })
})
