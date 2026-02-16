# Operations Guide

## Runtime Commands

Primary CLI commands:
- `seed` / `seed ui` — start TUI and attach/start local server
- `seed serve [--host ...] [--port ...]` — start headless server
- `seed status` — inspect server status for workspace
- `seed stop` — send SIGTERM to workspace server (best effort)

Task/agent mutation commands are intentionally UI-driven rather than exposed as direct CLI subcommands.

## Master Discovery Workflow

On startup, CLI resolves workspace and runs discovery:
1. read lock file,
2. verify PID alive,
3. probe `/api/health`,
4. choose mode:
   - healthy lock target => `client` mode,
   - otherwise => `master` mode.

Stale lockfiles are cleaned automatically when process or health checks fail.

## Server Lifecycle

In master mode:
- app is composed locally,
- auth token is generated,
- HTTP+WS server starts,
- lock file is written,
- cleanup hooks remove lock file on shutdown signals.

In client mode:
- app is composed with remote adapters,
- no local runtime ownership for task execution.

## Persistence Layout

Workspace state directory:
- `.seed/events.jsonl`
- `.seed/projections.jsonl`
- `.seed/audit.jsonl`
- `.seed/conversations.jsonl`
- lock file for server ownership metadata

## Health and Diagnostics

Useful endpoints:
- `GET /api/health`
- `GET /api/runtime`
- `GET /api/events?after=<id>`
- `GET /api/audit?limit=<n>&taskId=<id>`

WebSocket channel provides realtime domain and UI event streams.

## Configuration Surface

Most runtime behavior is env-driven via `src/config/appConfig.ts`, including:
- LLM provider/model/profile defaults,
- execution/interaction timeouts,
- output limits,
- telemetry sink,
- max subtask depth,
- tool schema export strategy.

## Dev Workflow

Typical local loop:
1. `npm install`
2. `npm run dev` (TUI path) or `npm run dev -- serve` (headless)
3. `npm test` for validation
4. `npm run build` for production build

## Operational Cautions

- keep one master process per workspace,
- avoid exposing server outside localhost without additional hardening,
- ensure lockfile cleanup if force-killing processes,
- monitor long-running background commands spawned by tools.
