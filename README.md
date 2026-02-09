# CoAuthor

**AI-powered co-authoring for STEM academic writing.**

CoAuthor is a task-driven, event-sourced system that pairs you with LLM agents to write LaTeX documents. It tracks every decision, supports human-in-the-loop interactions, and never blindly overwrites your work.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start the interactive TUI
npm run dev
```

### Create and Run Your First Task

```bash
# 1. Create a task (outputs a task ID)
npm run dev -- task create "Improve introduction" \
  --file paper/sections/introduction.tex --lines 1-200

# 2. Run the agent on the task
npm run dev -- agent run <taskId>

# 3. Check for pending user interactions
npm run dev -- interact pending <taskId>

# 4. Respond to interactions
npm run dev -- interact respond <taskId> <optionId> --text "Your input"

# 5. Replay what happened
npm run dev -- log replay <taskId>
```

---

## Core Concepts

### Tasks
Everything starts with a **Task**. A task represents a unit of work (e.g., "improve the introduction" or "fix grammar in section 3"). Tasks have a lifecycle: created → started → [paused/resumed] → completed/failed/canceled.

### User Interaction Protocol (UIP)
When the agent needs your input—like confirming a risky file edit or choosing between options—it creates a **UIP request**. The system pauses and waits for your response. No blind overwrites, ever.

### Event Sourcing
All collaboration decisions are stored as **Domain Events** in an append-only log (`.coauthor/events.jsonl`). You can replay the entire history of any task. File edits and command executions are recorded separately in an **Audit Log**.

### Tools
Agents use tools to interact with your workspace:
- `readFile` / `editFile` — File operations with diff previews
- `listFiles` / `glob` / `grep` — File discovery and search
- `runCommand` — Execute shell commands (requires confirmation)
- `createSubtask` — Decompose work into subtasks

---

## CLI Reference

### Task Commands
```bash
coauthor task create "Title" --file <path> --lines <n-m>   # Create a task
coauthor task list                                         # List all tasks
coauthor task cancel <taskId>                              # Cancel a task
coauthor task pause <taskId>                               # Pause a task
coauthor task resume <taskId>                              # Resume a task
coauthor task continue <taskId> "instruction"              # Add instruction
coauthor task refine <taskId> "instruction"                # Add refinement
```

### Agent Commands
```bash
coauthor agent run <taskId>           # Execute a task once
coauthor agent test "message"         # Create and run a test task
```

### Interaction Commands
```bash
coauthor interact pending [taskId]                    # Show pending UIP(s)
coauthor interact respond <taskId> <optionId>       # Respond to UIP
```

### Audit & Log Commands
```bash
coauthor audit list [taskId] --limit 20    # Show audit log
coauthor log replay [streamId]             # Replay events
```

---

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build for production
npm run build

# Run built version
npm start
```

### Project Structure

```
src/
├── domain/        # Domain layer: events, types, ports
├── application/   # Application services (use cases)
├── agents/        # Agent runtime and orchestration
├── infra/         # Infrastructure adapters
├── cli/           # Command-line interface
├── tui/           # Terminal UI (Ink + React)
└── app/           # Application composition root
```

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design and principles
- [Domain Model](docs/DOMAIN.md) — Domain events and types
- [Milestones](docs/MILESTONES.md) — Development roadmap

---

## License

[MIT](LICENSE) © Zherui Yang ([@Adversarr](https://github.com/Adversarr))