# Seed

**Personal AI assistant team for goal-driven work in a local workspace.**

Seed turns a user goal into coordinated execution across specialized agents. The goal acts as the initial seed for planning, tool use, subtasks, and human checkpoints.

Seed is event-sourced and task-oriented:
- every task decision is replayable,
- risky actions require explicit confirmation,
- tool execution is audit logged separately from domain lifecycle.

Writing support is one use case, not the primary product boundary.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start interactive TUI (and local server)
npm run dev

# Or run headless Web UI server only
npm run dev -- serve
```

---

## Core Concepts

### Goal -> Tasks
A user goal is decomposed into tasks and subtasks. Each task has a lifecycle:
`created -> started -> (awaiting_user | paused) -> completed | failed | canceled`.

### Human-in-the-loop safety
Risky operations (for example file edits or command execution) trigger a UIP request with context. Nothing is applied silently.

### Event sourcing + audit separation
- Domain lifecycle: `.seed/events.jsonl`
- Tool execution trace: `.seed/audit.jsonl`
- LLM conversation durability: `.seed/conversations.jsonl`

### Agent team
- `Coordinator Agent` (`agent_seed_coordinator`): default execution + delegation
- `Research Agent` (`agent_seed_research`): read-only workspace survey
- `Chat Agent` (`agent_seed_chat`): quick no-tool advisory

---

## CLI Reference

```bash
# Workspace selection (where .seed/ lives). Defaults to current directory.
seed --workspace <path> status
seed -w <path> status

# Start TUI (default command)
seed --workspace <path>
seed --workspace <path> ui

# Start Web UI server (headless)
seed --workspace <path> serve [--host 127.0.0.1] [--port 3000]

# Show server status
seed --workspace <path> status

# Stop workspace server (best-effort)
seed --workspace <path> stop
```

Task mutation/agent control flows are intentionally UI-driven (TUI/Web) rather than exposed as broad direct CLI mutation commands.

---

## Development

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Build
npm run build

# Run built CLI
npm start
```

### Project Structure

```text
src/
├── core/            # Domain entities, events, and ports
├── application/     # Use-case services and projections
├── agents/          # Agent implementations and orchestration runtime
├── infrastructure/  # Persistence, servers, tools, remote adapters, LLM clients
└── interfaces/      # App composition, CLI, TUI

web/                 # React Web UI
docs/                # Current architecture/domain/ops/security docs
demo/                # End-to-end demo assets and fake LLM script
```

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Domain Model](docs/DOMAIN.md)
- [Operations](docs/OPERATIONS.md)
- [Roadmap](roadmap.md)

---

## License

[MIT](LICENSE) © Zherui Yang ([@Adversarr](https://github.com/Adversarr))
