# LLM Configuration

## Provider Model

LLM provider selection is configured via environment variables and loaded by `loadAppConfig`.

Supported providers:
- `fake` (default) — deterministic/local testing behavior.
- `openai` — OpenAI-compatible API.
- `bailian` — Alibaba DashScope compatible API.
- `volcengine` — Volcengine Ark compatible API.

Env:
- `SEED_LLM_PROVIDER=fake|openai|bailian|volcengine`
- `SEED_LLM_API_KEY` (required for non-`fake` providers)
- `SEED_LLM_BASE_URL` (optional; provider default is used when omitted)

Provider default base URLs:
- `openai` → `https://api.openai.com/v1`
- `bailian` → `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `volcengine` → `https://ark.cn-beijing.volces.com/api/v3`

## Canonical Profile Catalog

Use one env var as source of truth:
- `SEED_LLM_PROFILES_JSON`

`SEED_LLM_PROFILES_JSON` supports two forms:
- Inline JSON object string.
- File path to JSON config:
  - Absolute path, or
  - Relative path resolved against the selected workspace directory (`--workspace`).

Schema:
- `defaultProfile: string`
- `clientPolicies: Record<string, ClientPolicy>`
- `profiles: Record<string, { model: string; clientPolicy: string }>`

Required built-in profile IDs:
- `fast`
- `writer`
- `reasoning`

Custom profile IDs are allowed.

### ClientPolicy schema

- `openaiCompat?: {`
  - `enableThinking?: boolean`
  - `webSearch?: {`
    - `enabled: boolean`
    - `onlyWhenNoFunctionTools?: boolean` (default `true`)
    - `maxKeyword?: number (1..50)`
    - `limit?: number (1..50)`
    - `sources?: string[]`
  - `}`
- `}`
- `provider?: {`
  - `bailian?: {`
    - `thinkingBudget?: number`
    - `forcedSearch?: boolean`
    - `searchStrategy?: turbo|max|agent|agent_max`
  - `}`
  - `volcengine?: {`
    - `thinkingType?: enabled|disabled|auto`
    - `reasoningEffort?: minimal|low|medium|high`
  - `}`
- `}`

Provider-specific policy knobs are validated against the active provider and rejected when mismatched.

## Example Profile Catalog

```json
{
  "defaultProfile": "fast",
  "clientPolicies": {
    "balanced": {
      "openaiCompat": {
        "enableThinking": true,
        "webSearch": {
          "enabled": false,
          "onlyWhenNoFunctionTools": true
        }
      }
    },
    "web_research": {
      "openaiCompat": {
        "enableThinking": true,
        "webSearch": {
          "enabled": true,
          "onlyWhenNoFunctionTools": true,
          "limit": 6
        }
      },
      "provider": {
        "volcengine": {
          "thinkingType": "auto",
          "reasoningEffort": "medium"
        }
      }
    }
  },
  "profiles": {
    "fast": { "model": "gpt-4o-mini", "clientPolicy": "balanced" },
    "writer": { "model": "gpt-4o", "clientPolicy": "balanced" },
    "reasoning": { "model": "gpt-4o", "clientPolicy": "balanced" },
    "research_web": { "model": "gpt-4o", "clientPolicy": "web_research" }
  }
}
```

## Runtime Surfaces

`GET /api/runtime` returns:
- `defaultAgentId`
- `streamingEnabled`
- `agents`
- `llm.provider`
- `llm.defaultProfile`
- `llm.profiles[]` (`id`, `model`, `clientPolicy`, `builtin`)
- `llm.globalProfileOverride`

`POST /api/runtime/profile` validates profile IDs dynamically from the catalog.

`POST /api/runtime/profile/clear` clears global profile override.

## Validation

All env parsing is validated through Zod in `src/config/appConfig.ts` and `src/config/llmProfileCatalog.ts`.
Invalid values fail fast at startup.
