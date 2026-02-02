# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CoAuthor is a co-authoring system for STEM academic writing using LLM agents. It provides a task-driven, event-sourced architecture for collaborative writing with LaTeX support.

**Current Milestone:** M0 (Billboard 基础闭环) - Core event sourcing and CLI scaffolding complete.

## Common Commands

### Development
```bash
npm install          # Install dependencies
npm run dev          # Run development server (tsx src/index.ts)
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

# Thread operations
npm run dev -- thread open <taskId>            # Open thread for task

# Patch operations
echo '<patch content>' | npm run dev -- patch propose <taskId> <targetPath>
npm run dev -- patch accept <taskId> [proposalId|latest]

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

### Architecture Pattern
**Hexagonal Architecture (Ports and Adapters)** with **Event Sourcing** and **CQRS**.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture design.
See [docs/DOMAIN.md](docs/DOMAIN.md) for domain model specification.
See [docs/MILESTONES.md](docs/MILESTONES.md) for milestone planning.

### Directory Structure
```
src/
├── index.ts              # CLI entry point
├── app/
│   └── createApp.ts      # App initialization with services
├── domain/               # Domain layer (types, schemas)
│   ├── actor.ts          # Actor types (User, Agent, System)
│   ├── task.ts           # Task, ArtifactRef types
│   ├── artifact.ts       # Artifact types (Figure, Table, etc.)
│   ├── events.ts         # Domain events (18 event types, Zod schemas)
│   ├── index.ts          # Domain exports
│   └── ports/            # Port interfaces
│       ├── eventStore.ts # EventStore interface
│       └── index.ts
├── application/          # Application services
│   ├── taskService.ts    # Task use cases
│   ├── patchService.ts   # Patch use cases
│   ├── eventService.ts   # Event replay use cases
│   └── index.ts
├── core/                 # Projections and projector
│   ├── operations.ts     # [DEPRECATED] Use application services
│   ├── projector.ts      # Projection runner with checkpoint
│   └── projections.ts    # Projection reducers for read models
├── infra/                # Infrastructure adapters
│   ├── jsonlEventStore.ts # JSONL-based event store
│   ├── sqliteEventStore.ts # SQLite-based event store
│   ├── sqlite.ts         # SQLite database helper
│   └── logger.ts         # Pino logger
├── cli/                  # CLI interface
│   ├── run.ts            # CLI command parser (yargs)
│   └── io.ts             # IO abstraction for testability
├── tui/                  # Terminal UI (Ink + React)
│   ├── main.tsx          # Main TUI component
│   └── run.ts            # TUI renderer
└── patch/                # Patch handling
    └── applyUnifiedPatch.ts  # Unified diff patch application

tests/                    # Test files (vitest)
docs/                     # Documentation
├── ARCHITECTURE.md       # Architecture design
├── DOMAIN.md             # Domain model spec
└── MILESTONES.md         # Milestone planning
.coauthor/                # Database directory
└── events.jsonl          # Event store (or coauthor.db for SQLite)
```

### Core Concepts

**Actor Model:**
- All actions are attributed to an Actor (`authorActorId`)
- Actor types: `user`, `agent`, `system`
- Well-known IDs: `system`, `default-user`, `default-agent`

**Event Sourcing:**
- All state changes are captured as events in an append-only log
- Events can be stored in JSONL or SQLite
- Events have `streamId`, `seq`, `type`, `payload`, `createdAt`
- Read models are built via projections that fold events into state

**Domain Events (18 types):**
- Task lifecycle: `TaskCreated`, `TaskRouted`, `TaskClaimed`, `TaskStarted`, `TaskCompleted`, `TaskFailed`, `TaskCanceled`, `TaskBlocked`
- Plan & Patch: `AgentPlanPosted`, `PatchProposed`, `PatchAccepted`, `PatchRejected`, `PatchApplied`
- Feedback & Interaction: `UserFeedbackPosted`, `ThreadOpened`
- Artifact & File: `ArtifactChanged`, `TaskNeedsRebase`, `TaskRebased`

**Projections:**
- `tasks` projection - Lists all tasks with metadata
- `threads` projection - Task threads with patch proposals
- Projections maintain cursor positions for incremental updates

**Hexagonal Architecture Layers:**
1. **Domain** (`src/domain/`): Types, event schemas, port interfaces. No external dependencies.
2. **Application** (`src/application/`): Use case services (TaskService, PatchService, EventService).
3. **Infrastructure** (`src/infra/`): EventStore adapters (JSONL, SQLite), logger.
4. **Interface** (`src/cli/`, `src/tui/`): CLI and TUI adapters.

## Important Patterns

**Testing Pattern:**
- Uses Vitest with Node environment
- `mock-fs` for filesystem mocking
- `ink-testing-library` for TUI component tests
- IO abstraction in CLI allows easy testing

**Patch Application:**
- Uses unified diff format
- Base revision checking to prevent drift
- Applied patches append `PatchApplied` event

**Database:**
- SQLite stored in `.coauthor/coauthor.db`
- Schema auto-created via `ensureSchema()`
- Events table is append-only

## Development Workflow

When making changes:
1. Run `npm run dev` for development testing
2. Add/update tests in `tests/` directory
3. Run `npm test` to verify
4. Build with `npm run build` before using CLI

When adding new domain events:
1. Add event payload schema to `src/domain/events.ts`
2. Add to `EventTypeSchema` enum
3. Add to `DomainEventSchema` discriminated union
4. Add to `DomainEvent` union type
5. Update projection reducers if needed in `src/core/projections.ts`
6. Add service method in appropriate `src/application/*.ts`
7. Add CLI command in `src/cli/run.ts` if user-facing

When adding new use cases:
1. Add method to appropriate service in `src/application/`
2. Services take `EventStore` and `currentActorId` in constructor
3. All events must include `authorActorId` field
4. Add CLI command in `src/cli/run.ts`
