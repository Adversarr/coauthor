import { z } from 'zod'
import type { LLMProfile, LLMProvider } from '../core/ports/llmClient.js'
import type { TaskPriority } from '../core/entities/task.js'
import {
  parseLLMProfileCatalogConfig,
  type LLMProfileCatalogConfig,
} from './llmProfileCatalog.js'

export type AppConfig = {
  telemetry: {
    sink: 'none' | 'console'
  }
  toolSchema: {
    strategy: 'zod' | 'jsonschema' | 'auto'
  }
  llm: {
    provider: LLMProvider
    apiKey: string | null
    baseURL: string | null
    profiles: LLMProfileCatalogConfig
  }
  agent: {
    maxIterations: number
    maxTokens: number
    defaultProfile: LLMProfile
  }
  timeouts: {
    interaction: number
    exec: number
  }
  resources: {
    auditLogLimit: number
    maxOutputLength: number
  }
  task: {
    defaultPriority: TaskPriority
  }
  /** Maximum nesting depth for subtasks (default 3). */
  maxSubtaskDepth: number
}

const EnvSchema = z.object({
  SEED_TELEMETRY_SINK: z.enum(['none', 'console']).default('none'),
  SEED_TOOL_SCHEMA_STRATEGY: z.enum(['zod', 'jsonschema', 'auto']).default('auto'),
  SEED_LLM_PROVIDER: z.enum(['fake', 'openai', 'bailian', 'volcengine']).default('fake'),
  SEED_LLM_API_KEY: z.string().min(1).optional(),
  SEED_LLM_BASE_URL: z.string().min(1).optional(),
  SEED_LLM_PROFILES_JSON: z.string().min(1).optional(),

  SEED_MAX_SUBTASK_DEPTH: z.coerce.number().int().min(0).default(3),

  // Agent
  SEED_AGENT_MAX_ITERATIONS: z.coerce.number().int().min(0).default(50),
  SEED_AGENT_MAX_TOKENS: z.coerce.number().int().min(0).default(4096),

  // Timeouts
  SEED_TIMEOUT_INTERACTION: z.coerce.number().int().min(0).default(300000), // 5 min
  SEED_TIMEOUT_EXEC: z.coerce.number().int().min(0).default(30000), // 30 sec

  // Resources
  SEED_AUDIT_LOG_LIMIT: z.coerce.number().int().min(1).default(20),
  SEED_MAX_OUTPUT_LENGTH: z.coerce.number().int().min(0).default(10000),

  // Task
  SEED_TASK_DEFAULT_PRIORITY: z.enum(['foreground', 'background']).default('foreground'),
})

export function loadAppConfig(
  env: NodeJS.ProcessEnv,
  opts?: { workspaceDir?: string },
): AppConfig {
  const parsed = EnvSchema.parse(env)
  const llmProvider = parsed.SEED_LLM_PROVIDER as LLMProvider
  const profileCatalog = parseLLMProfileCatalogConfig({
    raw: parsed.SEED_LLM_PROFILES_JSON,
    provider: llmProvider,
    workspaceDir: opts?.workspaceDir,
  })

  const config: AppConfig = {
    telemetry: {
      sink: parsed.SEED_TELEMETRY_SINK,
    },
    toolSchema: {
      strategy: parsed.SEED_TOOL_SCHEMA_STRATEGY,
    },
    llm: {
      provider: llmProvider,
      apiKey: parsed.SEED_LLM_API_KEY ?? null,
      baseURL: parsed.SEED_LLM_BASE_URL ?? null,
      profiles: profileCatalog,
    },
    agent: {
      maxIterations: parsed.SEED_AGENT_MAX_ITERATIONS,
      maxTokens: parsed.SEED_AGENT_MAX_TOKENS,
      // Agent defaults follow LLM profile catalog defaults.
      defaultProfile: profileCatalog.defaultProfile,
    },
    timeouts: {
      interaction: parsed.SEED_TIMEOUT_INTERACTION,
      exec: parsed.SEED_TIMEOUT_EXEC,
    },
    resources: {
      auditLogLimit: parsed.SEED_AUDIT_LOG_LIMIT,
      maxOutputLength: parsed.SEED_MAX_OUTPUT_LENGTH,
    },
    task: {
      defaultPriority: parsed.SEED_TASK_DEFAULT_PRIORITY as TaskPriority,
    },
    maxSubtaskDepth: parsed.SEED_MAX_SUBTASK_DEPTH,
  }

  return config
}
