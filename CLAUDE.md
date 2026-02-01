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

### Directory Structure
```
src/
├── index.ts              # CLI entry point
├── app/
│   └── createApp.ts      # App initialization with EventStore
├── core/                 # Domain layer (pure logic, no external deps)
│   ├── domain.ts         # Domain entities, events schema (Zod)
│   ├── eventStore.ts     # SQLite-based event store
│   ├── operations.ts     # Use cases (createTask, acceptPatch, etc.)
│   ├── projector.ts      # Projection runner with checkpoint
│   └── projections.ts    # Projection reducers for read models
├── infra/                # Infrastructure layer
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
.coauthor/                # Database directory
└── coauthor.db          # SQLite event store
```

### Core Concepts

**Event Sourcing:**
- All state changes are captured as events in an append-only log
- Events are stored in SQLite (`events` table with `streamId`, `seq`, `type`, `payload`, `createdAt`)
- Read models are built via projections that fold events into state

**Domain Events:**
- `TaskCreated` - New task created
- `ThreadOpened` - Thread opened for task
- `PatchProposed` - Patch proposed for review
- `PatchApplied` - Patch accepted and applied

**Projections:**
- `tasks` projection - Lists all tasks with metadata
- `threads` projection - Task threads with patch proposals
- Projections maintain cursor positions for incremental updates

**Hexagonal Architecture Layers:**
1. **Domain** (`src/core/`): Pure TypeScript, no external dependencies. Domain entities, events, projections.
2. **Application** (`src/app/`): Use cases, app initialization.
3. **Infrastructure** (`src/infra/`): SQLite event store, logger.
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
1. Add event schema to `src/core/domain.ts`
2. Add to `EventTypeSchema` enum
3. Update `DomainEventSchema` discriminated union
4. Add projection reducers if needed in `src/core/projections.ts`
5. Add operation function in `src/core/operations.ts`
6. Add CLI command in `src/cli/run.ts` if user-facing
