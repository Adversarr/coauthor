# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview (MVP; no backwards-compat guarantees)

CoAuthor is a co-authoring system for STEM academic writing using LLM agents running on local machines. It provides a task-driven, event-sourced architecture for collaborative writing with LaTeX support.

**Current Milestone:** MVP with tasks, agent runtime execution, UIP (Universal Interaction Protocol), and UIs (TUI + Web UI). Architecture and domain model can change frequently.

## Common Commands

### Development
```bash
npm install          # Install dependencies
npm run dev          # Run development server with TUI (tsx src/index.ts)
```

### Build and Run
```bash
npm run build        # Build TypeScript (tsc -p tsconfig.json)
npm start            # Run built executable (node dist/index.js)
```

### Testing
```bash
npm test             # Run all tests (vitest run)
npm run test:watch   # Run tests in watch mode
npm run coverage     # Run tests with coverage (v8 provider)
```

### Running Single Tests
```bash
npx vitest run tests/eventStore.test.ts     # Run specific test file
npx vitest run -t "should create task"       # Run tests matching pattern
```

### Using the CLI

**Development mode (recommended for testing):**
```bash
# Task operations
npm run dev -- task create "Task title"         # Create a task
npm run dev -- task list                        # List all tasks
npm run dev -- task cancel <taskId>             # Cancel a task
npm run dev -- task pause <taskId>              # Pause a task
npm run dev -- task resume <taskId>             # Resume a task
npm run dev -- task continue <taskId> "..."     # Add instruction to a task
npm run dev -- task refine <taskId> "..."       # Add refinement instruction

# Agent operations
npm run dev -- agent run <taskId>               # Execute a task once
npm run dev -- agent test "say hello"           # Create and run a test task

# User interaction (UIP)
npm run dev -- interact pending [taskId]        # Show pending UIP(s)
npm run dev -- interact respond <taskId> <optionId> [--text "..."]

# Audit log
npm run dev -- audit list [taskId] --limit 20

# Event log
npm run dev -- log replay [streamId]           # Replay events

# Terminal UI
npm run dev                                     # Start Ink TUI (default)
```

**Production mode (after build):**
```bash
node dist/index.js task create "Task title"
node dist/index.js task list
# ... same commands as above
```

## Architecture Overview

### Mental Model
- **Hexagonal (Ports/Adapters)** + **Event Sourcing** + **CQRS (pull-based projections)**.
- **Master process** owns persistence + agent execution and exposes **HTTP + WebSocket** on localhost.
- **Client processes** (CLI/TUI/Web UI) call **HTTP for commands/queries** and use **WS for realtime streams**.
- Two realtime planes:
  - **Domain event stream**: `EventStore.events$` (append-only StoredEvents).
  - **UI event stream**: `UiBus.events$` (agent output, streaming deltas, forwarded audit entries).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the normative (V0.x) spec.
See [docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md) for the current implementation-centric coupling map (HTTP/Web UI/WS + buses).
See [docs/DOMAIN.md](docs/DOMAIN.md) for domain model specification.

### Key Entry Points
- App wiring: `src/app/createApp.ts` (local) and `src/app/createRemoteApp.ts` (client mode).
- Master server: `src/infra/server.ts` (HTTP + WS + static Web UI).
- HTTP API: `src/infra/http/httpServer.ts` (Hono routes; calls application services).
- WS fanout: `src/infra/ws/wsServer.ts` (bridges `EventStore.events$` + `UiBus.events$`).
- Agent runtime: `src/agents/runtimeManager.ts` (subscribes to domain events, orchestrates per-task runtimes).
- Web UI: `web/src/services/{api,ws}.ts` + Zustand stores in `web/src/stores/`.

### Directory Structure (high-signal)
```
src/
├── index.ts                 # CLI entry point
├── app/                      # Composition roots (local + remote)
├── domain/                   # Domain types, events, ports (no external deps)
├── application/              # Use cases (Task/Event/Interaction/Audit services)
├── agents/                   # RuntimeManager + task-scoped runtimes + output handling
├── infra/                    # Adapters (JSONL stores, HTTP/WS server, tools)
├── cli/                      # CLI adapter
└── tui/                      # TUI adapter (Ink)

tests/                    # Test files (vitest)
docs/                     # Documentation
web/                      # Web UI (Vite + React) and build output (web/dist)
.coauthor/                # Local data directory (JSONL)
├── events.jsonl          # Domain event log (append-only)
├── projections.jsonl     # Projection checkpoints
├── audit.jsonl           # Tool audit log (append-only)
└── conversations.jsonl   # LLM conversation persistence
```

### Core Concepts

**Actor Model:**
- All actions are attributed to an Actor (`authorActorId`)
- Actor types: `user`, `agent`, `system`
- Well-known IDs: `system`, `default-user`, `default-agent`
- Every domain event MUST include `authorActorId` field

**Event Sourcing:**
- All state changes are captured as events in an append-only log
- Events are stored in JSONL format (`.coauthor/events.jsonl`)
- Events have `streamId`, `seq`, `type`, `payload`, `createdAt`, `authorActorId`
- Read models are built via projections that fold events into state
- No direct state mutations - only through events

**Domain Events:**
- Task lifecycle: `TaskCreated`, `TaskStarted`, `TaskCompleted`, `TaskFailed`, `TaskCanceled`, `TaskPaused`, `TaskResumed`
- Instructions: `TaskInstructionAdded`
- UIP: `UserInteractionRequested`, `UserInteractionResponded`
- All events defined with Zod schemas in `src/domain/events.ts`
- File modifications and command execution are recorded in AuditLog, not DomainEvents

**Projections:**
- Projections are computed by folding events (`runProjection`) and checkpointed in `.coauthor/projections.jsonl`.
- UIs typically treat `events$` as a “refresh trigger” and re-run projections, not as an incremental reducer.

**Hexagonal Architecture Layers:**
1. **Domain** (`src/domain/`): Pure types, event schemas, port interfaces. Zero external dependencies.
2. **Application** (`src/application/`): Use case services implementing business logic.
3. **Infrastructure** (`src/infra/`): JSONL stores, HTTP/WS server, tool adapters.
4. **Agents** (`src/agents/`): RuntimeManager subscribes to `EventStore.events$` and manages per-task runtimes.
5. **Interfaces** (`src/cli/`, `src/tui/`, `web/`): Adapters that call services and subscribe to streams.

### Dependency Flow
```
Adapters (CLI/TUI/Web) → Application → Domain Ports ← Infra Adapters
                             ↓
                        Domain Events
```

## Important Patterns

**EventStore vs UiBus:**
- Domain events = collaboration history + task lifecycle.
- UiBus events = live UX stream (agent output, streaming deltas, forwarded audit entries).

**Tool Use + Audit Log:**
- Tool calls are executed via `ToolExecutor` and recorded in `audit.jsonl`.
- Risky tool actions require UIP confirmation.

## Development Workflow

### Making Changes

1. **Run development mode:** `npm run dev` for quick iteration
2. **Add/update tests:** Place in `tests/` directory, mirror source structure
3. **Run tests:** `npm test` to verify all tests pass
4. **Build:** `npm run build` before committing or using production CLI

### Adding New Domain Events

1. Add event payload schema to `src/domain/events.ts` (Zod schema)
2. Add event type to `EventTypeSchema` enum
3. Add to `DomainEventSchema` discriminated union
4. Add to `DomainEvent` TypeScript union type
5. Update projection reducers in service methods (e.g., `TaskService.#buildTasksProjection`)
6. Add service method in appropriate `src/application/*.ts`
7. Add CLI command in `src/cli/run.ts` if user-facing
8. Add tests for event emission and projection

### Adding New Use Cases

1. **Add method to service** in `src/application/`
2. **Service constructor** takes `EventStore` and `currentActorId`
3. **Emit events** with `authorActorId` field (required!)
4. **Return results** by building projections or querying event store
5. **Add CLI command** in `src/cli/run.ts`
6. **Add tests** verifying event emission and business logic

### Adding New Adapters

1. **Define port interface** in `src/domain/ports/` (if needed)
2. **Implement adapter** in `src/infra/`
3. **Inject via app** in `src/app/createApp.ts`
4. **Mock in tests** using vitest mocking

## Code Principles

- **Event-first thinking:** Every state change is an event
- **Immutability:** Never mutate existing state, only append events
- **Dependency inversion:** Domain depends on ports, infrastructure implements ports
- **Actor attribution:** Every action must have an `authorActorId`
- **Type safety:** Use Zod schemas for runtime validation, TypeScript for compile-time safety
- **Testability:** Design for testing - use interfaces, dependency injection, IO abstraction

## Common Issues & Solutions

**"Cannot find module" errors:**
- Run `npm install` to ensure dependencies are installed
- Check TypeScript paths configuration in `tsconfig.json`

**Event store corruption:**
- `.coauthor/events.jsonl` should contain valid JSON lines
- Delete `.coauthor/` directory to reset (lose all data!)

**Projection out of sync:**
- Delete `.coauthor/projections.jsonl` to rebuild from events
- Projections will automatically rebuild on next read

**Tests failing:**
- Ensure `mock-fs` is properly cleaned up (`mock.restore()`)
- Check that event schemas match expectations
- Verify `authorActorId` is set on all events

# Extra Guidelines

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.