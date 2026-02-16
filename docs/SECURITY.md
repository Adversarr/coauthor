# Security Model

## Security Posture

Seed is designed primarily for local, developer-machine operation with a localhost server and per-workspace state.

Primary security goals:
- prevent unauthorized command/control access,
- prevent workspace path escape,
- keep risky actions user-confirmed,
- preserve auditability for tool execution.

## Trust Boundaries

- Browser/TUI client ↔ HTTP/WS server (`SeedServer`)
- Server ↔ local filesystem (`FsArtifactStore`)
- Agent ↔ tool execution (`ToolExecutor`)
- Domain events ↔ audit trail (separate storage)

## Authentication and Access

HTTP API auth behavior:
- bearer token is generated at server start and stored in lock file.
- `/api/health` is unauthenticated for liveness checks.
- localhost requests may bypass token check (server defaults to `127.0.0.1`).
- token query fallback exists for transport constraints (e.g. streaming clients).

WS auth:
- token is required in connection query (`/ws?token=...`).

Operational recommendation:
- keep server bound to localhost unless you add external hardening.

## Filesystem Safety

Both HTTP file endpoints and artifact store apply path safety controls.

Protections include:
- reject absolute paths for API file operations,
- resolve-relative path containment checks,
- symlink-aware realpath checks to prevent escaping workspace,
- null-byte and malformed-path rejection.

## Tool Risk Controls

Tools are classified as:
- `safe`
- `risky`

`risky` tools (e.g., file edits, command execution) require explicit confirmation flow through UIP before execution.

`ToolExecutor` and orchestration enforce this boundary; rejected risky calls are still audit-recorded.

## Resource/Abuse Controls

- HTTP request body max size: 10 MB.
- command execution timeout defaults (`SEED_TIMEOUT_EXEC`).
- command output truncation (`SEED_MAX_OUTPUT_LENGTH`).
- interaction timeout defaults (`SEED_TIMEOUT_INTERACTION`).
- API list endpoints clamp limits (e.g., max 500 events/audit entries per query).

## Process and Multi-Client Safety

A lock-file + health-check discovery model prevents multiple local writers for one workspace.

Only one master process should own JSONL append streams, reducing corruption/race risk.

## Data Integrity and Traceability

- `events.jsonl` captures lifecycle/interaction decisions.
- `audit.jsonl` captures tool call request/completion details.
- `conversations.jsonl` captures LLM conversation history.

This separation supports replayability and incident/debug traceability.

## Hardening Notes

If deploying beyond localhost/dev usage:
- enforce bearer auth for all requests (no localhost bypass),
- bind to private interface intentionally,
- add TLS termination and origin controls,
- rotate tokens and reduce token exposure surface,
- restrict/disable command execution tools where possible.
