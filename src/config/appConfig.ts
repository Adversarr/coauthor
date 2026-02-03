import { z } from 'zod'
import type { LLMProfile } from '../domain/ports/llmClient.js'

export type AppConfig = {
  llm: {
    provider: 'fake' | 'openai'
    openai: {
      apiKey: string | null
      baseURL: string | null
      modelByProfile: Record<LLMProfile, string>
    }
  }
}

const EnvSchema = z.object({
  COAUTHOR_LLM_PROVIDER: z.enum(['fake', 'openai']).default('fake'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  COAUTHOR_OPENAI_BASE_URL: z.string().min(1).optional(),
  COAUTHOR_OPENAI_MODEL_FAST: z.string().min(1).default('gpt-4o-mini'),
  COAUTHOR_OPENAI_MODEL_WRITER: z.string().min(1).default('gpt-4o'),
  COAUTHOR_OPENAI_MODEL_REASONING: z.string().min(1).default('gpt-4o')
})

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.parse(env)
  return {
    llm: {
      provider: parsed.COAUTHOR_LLM_PROVIDER,
      openai: {
        apiKey: parsed.OPENAI_API_KEY ?? null,
        baseURL: parsed.COAUTHOR_OPENAI_BASE_URL ?? null,
        modelByProfile: {
          fast: parsed.COAUTHOR_OPENAI_MODEL_FAST,
          writer: parsed.COAUTHOR_OPENAI_MODEL_WRITER,
          reasoning: parsed.COAUTHOR_OPENAI_MODEL_REASONING
        }
      }
    }
  }
}
