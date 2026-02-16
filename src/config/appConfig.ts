import { z } from 'zod'
import type { LLMProfile } from '../core/ports/llmClient.js'
import type { TaskPriority } from '../core/entities/task.js'

export type AppConfig = {
  telemetry: {
    sink: 'none' | 'console'
  }
  toolSchema: {
    strategy: 'zod' | 'jsonschema' | 'auto'
  }
  llm: {
    provider: 'fake' | 'openai'
    openai: {
      apiKey: string | null
      baseURL: string | null
      modelByProfile: Record<LLMProfile, string>
    }
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
  SEED_LLM_PROVIDER: z.enum(['fake', 'openai']).default('fake'),
  SEED_OPENAI_API_KEY: z.string().min(1).optional(),
  SEED_OPENAI_BASE_URL: z.string().min(1).optional(),
  SEED_OPENAI_MODEL_FAST: z.string().min(1).default('gpt-4o-mini'),
  SEED_OPENAI_MODEL_WRITER: z.string().min(1).default('gpt-4o'),
  SEED_OPENAI_MODEL_REASONING: z.string().min(1).default('gpt-4o'),
  SEED_MAX_SUBTASK_DEPTH: z.coerce.number().int().min(0).default(3),
  
  // Agent
  SEED_AGENT_MAX_ITERATIONS: z.coerce.number().int().min(0).default(50),
  SEED_AGENT_MAX_TOKENS: z.coerce.number().int().min(0).default(4096),
  SEED_AGENT_DEFAULT_PROFILE: z.enum(['fast', 'writer', 'reasoning']).default('fast'),

  // Timeouts
  SEED_TIMEOUT_INTERACTION: z.coerce.number().int().min(0).default(300000), // 5 min
  SEED_TIMEOUT_EXEC: z.coerce.number().int().min(0).default(30000), // 30 sec

  // Resources
  SEED_AUDIT_LOG_LIMIT: z.coerce.number().int().min(1).default(20),
  SEED_MAX_OUTPUT_LENGTH: z.coerce.number().int().min(0).default(10000),

  // Task
  SEED_TASK_DEFAULT_PRIORITY: z.enum(['foreground', 'background']).default('foreground')
})

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.parse(env)
  const config = {
    telemetry: {
      sink: parsed.SEED_TELEMETRY_SINK,
    },
    toolSchema: {
      strategy: parsed.SEED_TOOL_SCHEMA_STRATEGY,
    },
    llm: {
      provider: parsed.SEED_LLM_PROVIDER,
      openai: {
        apiKey: parsed.SEED_OPENAI_API_KEY ?? null,
        baseURL: parsed.SEED_OPENAI_BASE_URL ?? null,
        modelByProfile: {
          fast: parsed.SEED_OPENAI_MODEL_FAST,
          writer: parsed.SEED_OPENAI_MODEL_WRITER,
          reasoning: parsed.SEED_OPENAI_MODEL_REASONING
        }
      }
    },
    agent: {
      maxIterations: parsed.SEED_AGENT_MAX_ITERATIONS,
      maxTokens: parsed.SEED_AGENT_MAX_TOKENS,
      defaultProfile: parsed.SEED_AGENT_DEFAULT_PROFILE as LLMProfile
    },
    timeouts: {
      interaction: parsed.SEED_TIMEOUT_INTERACTION,
      exec: parsed.SEED_TIMEOUT_EXEC
    },
    resources: {
      auditLogLimit: parsed.SEED_AUDIT_LOG_LIMIT,
      maxOutputLength: parsed.SEED_MAX_OUTPUT_LENGTH
    },
    task: {
      defaultPriority: parsed.SEED_TASK_DEFAULT_PRIORITY as TaskPriority
    },
    maxSubtaskDepth: parsed.SEED_MAX_SUBTASK_DEPTH
  }

  return config
}
