import { z } from 'zod'
import type { LLMProfile } from '../domain/ports/llmClient.js'
import type { TaskPriority } from '../domain/task.js'

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
  COAUTHOR_TELEMETRY_SINK: z.enum(['none', 'console']).default('none'),
  COAUTHOR_TOOL_SCHEMA_STRATEGY: z.enum(['zod', 'jsonschema', 'auto']).default('auto'),
  COAUTHOR_LLM_PROVIDER: z.enum(['fake', 'openai']).default('fake'),
  COAUTHOR_OPENAI_API_KEY: z.string().min(1).optional(),
  COAUTHOR_OPENAI_BASE_URL: z.string().min(1).optional(),
  COAUTHOR_OPENAI_MODEL_FAST: z.string().min(1).default('gpt-4o-mini'),
  COAUTHOR_OPENAI_MODEL_WRITER: z.string().min(1).default('gpt-4o'),
  COAUTHOR_OPENAI_MODEL_REASONING: z.string().min(1).default('gpt-4o'),
  COAUTHOR_MAX_SUBTASK_DEPTH: z.coerce.number().int().min(0).default(3),
  
  // Agent
  COAUTHOR_AGENT_MAX_ITERATIONS: z.coerce.number().int().min(0).default(50),
  COAUTHOR_AGENT_MAX_TOKENS: z.coerce.number().int().min(0).default(4096),
  COAUTHOR_AGENT_DEFAULT_PROFILE: z.enum(['fast', 'writer', 'reasoning']).default('fast'),

  // Timeouts
  COAUTHOR_TIMEOUT_INTERACTION: z.coerce.number().int().min(0).default(300000), // 5 min
  COAUTHOR_TIMEOUT_EXEC: z.coerce.number().int().min(0).default(30000), // 30 sec

  // Resources
  COAUTHOR_AUDIT_LOG_LIMIT: z.coerce.number().int().min(1).default(20),
  COAUTHOR_MAX_OUTPUT_LENGTH: z.coerce.number().int().min(0).default(10000),

  // Task
  COAUTHOR_TASK_DEFAULT_PRIORITY: z.enum(['foreground', 'background']).default('foreground')
})

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.parse(env)
  const config = {
    telemetry: {
      sink: parsed.COAUTHOR_TELEMETRY_SINK,
    },
    toolSchema: {
      strategy: parsed.COAUTHOR_TOOL_SCHEMA_STRATEGY,
    },
    llm: {
      provider: parsed.COAUTHOR_LLM_PROVIDER,
      openai: {
        apiKey: parsed.COAUTHOR_OPENAI_API_KEY ?? null,
        baseURL: parsed.COAUTHOR_OPENAI_BASE_URL ?? null,
        modelByProfile: {
          fast: parsed.COAUTHOR_OPENAI_MODEL_FAST,
          writer: parsed.COAUTHOR_OPENAI_MODEL_WRITER,
          reasoning: parsed.COAUTHOR_OPENAI_MODEL_REASONING
        }
      }
    },
    agent: {
      maxIterations: parsed.COAUTHOR_AGENT_MAX_ITERATIONS,
      maxTokens: parsed.COAUTHOR_AGENT_MAX_TOKENS,
      defaultProfile: parsed.COAUTHOR_AGENT_DEFAULT_PROFILE as LLMProfile
    },
    timeouts: {
      interaction: parsed.COAUTHOR_TIMEOUT_INTERACTION,
      exec: parsed.COAUTHOR_TIMEOUT_EXEC
    },
    resources: {
      auditLogLimit: parsed.COAUTHOR_AUDIT_LOG_LIMIT,
      maxOutputLength: parsed.COAUTHOR_MAX_OUTPUT_LENGTH
    },
    task: {
      defaultPriority: parsed.COAUTHOR_TASK_DEFAULT_PRIORITY as TaskPriority
    },
    maxSubtaskDepth: parsed.COAUTHOR_MAX_SUBTASK_DEPTH
  }

  return config
}
