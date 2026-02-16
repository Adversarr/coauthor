# LLM Configuration

## Provider Model

LLM provider selection is configured via environment variables and loaded by `loadAppConfig`.

Supported providers:
- `fake` (default) — deterministic/local testing behavior.
- `openai` — OpenAI-compatible API via `OpenAILLMClient`.

Env:
- `SEED_LLM_PROVIDER=fake|openai`

## OpenAI Settings

When provider is `openai`, configure:
- `SEED_OPENAI_API_KEY`
- `SEED_OPENAI_BASE_URL` (optional, for compatible gateways/proxies)

Profile-to-model mapping:
- `SEED_OPENAI_MODEL_FAST` (default `gpt-4o-mini`)
- `SEED_OPENAI_MODEL_WRITER` (default `gpt-4o`)
- `SEED_OPENAI_MODEL_REASONING` (default `gpt-4o`)

## Profiles

Profiles used by orchestration:
- `fast`
- `writer`
- `reasoning`

Agent default profile:
- `SEED_AGENT_DEFAULT_PROFILE` (default `fast`)

Runtime can apply profile overrides globally (`*`) via runtime API.

## Tool Schema Strategy

OpenAI tool declaration strategy is configurable:
- `SEED_TOOL_SCHEMA_STRATEGY=zod|jsonschema|auto`
- default: `auto`

This controls how tool parameter schema is exported to the LLM API.

## Token/Iteration Limits

Agent-level controls:
- `SEED_AGENT_MAX_ITERATIONS` (default `50`)
- `SEED_AGENT_MAX_TOKENS` (default `4096`)

Execution timeout and output control:
- `SEED_TIMEOUT_EXEC` (default `30000` ms)
- `SEED_MAX_OUTPUT_LENGTH` (default `10000` chars)

## Streaming

LLM client supports both:
- `complete` (non-streaming)
- `stream` (chunked: text/reasoning/tool-call deltas)

Runtime streaming is controlled by runtime state (`streamingEnabled`) and can be toggled through HTTP API (`POST /api/runtime/streaming`).

## Validation and Defaults

All env parsing is validated through Zod in `src/config/appConfig.ts`; invalid values fail fast at config load.

## Recommended Development Setup

For local development without external API calls:
- keep `SEED_LLM_PROVIDER=fake`

For OpenAI mode:
- set API key,
- optionally set base URL,
- set profile models to balance speed/cost/quality.
