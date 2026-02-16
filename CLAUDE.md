# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Seed is a local-first personal AI assistant team runtime.

Key traits:
- task-driven orchestration,
- event-sourced lifecycle (`.seed/events.jsonl`),
- separate audit trail for tool calls (`.seed/audit.jsonl`),
- UIP confirmations for risky actions,
- TUI + Web UI over shared backend contracts.

## Current Agent Team

- `agent_seed_coordinator` (`Coordinator Agent`): default tool-using execution agent.
- `agent_seed_research` (`Research Agent`): read-only survey/search agent.
- `agent_seed_chat` (`Chat Agent`): no-tool conversational helper.

## Common Commands

### Development
```bash
npm install
npm run dev
```

### Build and run
```bash
npm run build
npm start
```

### Tests
```bash
npm test
npm run test:watch
npm run coverage
```

### CLI usage
```bash
# Start TUI for current workspace
npm run dev --

# Headless server
npm run dev -- serve

# Status and stop
npm run dev -- status
npm run dev -- stop

# Workspace override
npm run dev -- --workspace /path/to/workspace status
```

Note: task mutation/agent orchestration commands are intentionally UI-driven (TUI/Web), not exposed as broad direct CLI mutation commands.

## Architecture Map

- App composition: `src/interfaces/app/createApp.ts`, `src/interfaces/app/createRemoteApp.ts`
- CLI: `src/interfaces/cli/run.ts`
- TUI: `src/interfaces/tui/`
- Core domain/contracts: `src/core/`
- Application services/projections: `src/application/`
- Agent runtime/orchestration: `src/agents/`
- Infrastructure adapters: `src/infrastructure/`
- Web UI: `web/src/`

## Persistence Layout

Workspace local data in `.seed/`:
- `events.jsonl`
- `projections.jsonl`
- `audit.jsonl`
- `conversations.jsonl`
- `server.lock`

## Working Principles

1. Keep changes minimal and scoped.
2. Preserve event/audit/UIP invariants.
3. Add or update tests for behavior changes.
4. Prefer explicit evidence from files/tests/tool output.
5. Keep docs consistent with runtime behavior.

## Known Legacy Boundary

Historical documents under `docs/legacy/` intentionally keep pre-seed naming and are not source of truth for current implementation behavior.
