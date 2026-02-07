# Technical Debt Survey

Date: 2026-02-07
Role: Lead Architect review

Scope: Repository source, configs, and docs under `src/`, `docs/`, `tests/`, `scripts/`, `demo/`, and root config files. Generated directories (`node_modules/`, `dist/`, `coverage/`) were excluded.

Summary: The architecture largely follows the intended hexagonal/Event Sourcing design, but several core boundaries are bypassed, validation is deferred to projections, and the storage/eventing layer assumes a single-process runtime. The result is a system that will be hard to scale to multiple adapters/processes and will accumulate brittle, inconsistent state as event volume grows.

## Priority Legend

P0: Immediate correctness or data-loss risk in current usage.
P1: High risk to reliability/scalability as usage grows or adapters multiply.
P2: Medium risk that increases integration or evolution cost.
P3: Low risk; mostly maintainability or cleanliness.
P4: Resolved or informational only.

## Findings

1. [P4] Architectural spec drift between docs and implementation. (Resolved 2026-02-07)
Paths: `docs/DOMAIN.md`, `docs/ARCHITECTURE.md`, `src/domain/events.ts`, `src/application/taskService.ts`.
Resolution: Updated `docs/DOMAIN.md` and `docs/ARCHITECTURE.md` to include `TaskPaused`, `TaskResumed`, and `TaskInstructionAdded` in the V0.2 event set and workflow. The documented lifecycle now matches the implementation.

2. [P2] Port boundary bypass for filesystem access.
Paths: `src/domain/ports/artifactStore.ts`, `src/infra/fsArtifactStore.ts`, `src/application/contextBuilder.ts`, `src/infra/tools/readFile.ts`, `src/infra/tools/editFile.ts`, `src/infra/tools/listFiles.ts`.
Risk: The architecture defines `ArtifactStore` as the abstraction for file access, but core workflows and tools directly use `fs`. This creates high coupling to Node’s filesystem APIs, makes it hard to swap adapters (e.g., remote or sandboxed storage), and complicates testing. As new adapters are added, logic duplication will grow.

3. [P3] Domain ports depend directly on RxJS.
Paths: `src/domain/ports/eventStore.ts`, `src/domain/ports/auditLog.ts`, `src/domain/ports/uiBus.ts`.
Risk: The domain layer is no longer independent of infrastructure concerns. Any effort to replace RxJS or run in environments without it requires touching domain interfaces and rippling changes across the system, raising the cost of architectural change.

4. [P1] Event validation and state transitions are enforced only in projections.
Paths: `src/application/taskService.ts`, `src/application/projector.ts`, `src/agents/runtime.ts`, `src/infra/jsonlEventStore.ts`, `src/domain/events.ts`.
Risk: Invalid events can be appended (for example repeated `TaskStarted` in disallowed states), and projections silently ignore them. This allows the event log to drift from the read models, breaking replay, testing, and any future projections. Debugging becomes expensive because the source of truth no longer matches observed state.

5. [P1] Event store and projections assume single-process execution.
Paths: `src/infra/jsonlEventStore.ts`, `src/application/projector.ts`, `src/agents/runtimeManager.ts`, `src/tui/main.tsx`.
Risk: Events are streamed through an in-memory Subject; external writers will not trigger runtime execution or UI refresh. Projection state is read/updated without optimistic concurrency or durable subscriptions. This blocks scaling to multiple adapters (CLI/TUI/web) or multiple processes and creates race conditions in shared workspaces.

6. [P1] JSONL stores use full-file reads and synchronous I/O on hot paths.
Paths: `src/infra/jsonlEventStore.ts`, `src/infra/jsonlConversationStore.ts`, `src/infra/jsonlAuditLog.ts`, `src/application/taskService.ts`, `src/application/interactionService.ts`.
Risk: Many operations read the entire JSONL file on each call, and several operations are synchronous. As event history grows, latency and CPU usage will degrade sharply. This creates scalability ceilings and makes the UI less responsive under real workloads.

7. [P1] Conversation and audit stores lack locking and atomicity guarantees.
Paths: `src/infra/jsonlConversationStore.ts`, `src/infra/jsonlAuditLog.ts`.
Risk: Concurrent writes or a crash during rewrite can corrupt JSONL files or drop data. This is especially risky as soon as multiple adapters or background tasks are introduced, and it undermines the reliability of recovery mechanisms.

8. [P1] Read-path fragility on malformed rows.
Paths: `src/infra/jsonlEventStore.ts`, `src/infra/jsonlAuditLog.ts`.
Risk: A single malformed or partial JSONL row can throw during parsing and break reads for the entire store. This makes the system brittle under partial writes or manual edits, and can block task listing, replay, and audit inspection.

9. [P2] Polling-based interaction waits and repeated stream scans.
Paths: `src/application/interactionService.ts`, `src/application/taskService.ts`.
Risk: `waitForResponse` polls the event store every 100ms and scans the stream repeatedly. This is wasteful under load and will not scale with larger event volumes or many concurrent tasks.

10. [P2] Conversation recovery replays “safe” tool calls without stronger guarantees.
Paths: `src/agents/conversationManager.ts`, `src/domain/ports/tool.ts`.
Risk: Recovery will re-execute any tool marked `safe`. If a tool is misclassified or evolves to have side effects, recovery can introduce duplicate actions. This risk grows as the tool catalog expands and increases the burden of keeping risk classification correct.

11. [P3] Duplicate prompt-building logic with inconsistent behavior.
Paths: `src/application/contextBuilder.ts`, `src/agents/defaultAgent.ts`.
Risk: `ContextBuilder.buildTaskMessages` and `DefaultCoAuthorAgent.#buildTaskPrompt` encode overlapping responsibilities with different content. This can cause prompt drift and inconsistent agent behavior, making future changes harder to reason about and test.

12. [P3] Debug logging leaks into core runtime paths.
Paths: `src/agents/conversationManager.ts`, `src/infra/openaiLLMClient.ts`.
Risk: Unstructured console logging in core services can pollute CLI/TUI output and complicate troubleshooting. As the system scales, a lack of structured logging/levels reduces maintainability and makes observability harder.

## Notes

- The issues above are technical debt items rather than immediate defects. They indicate areas where design intent and implementation are misaligned or where scalability assumptions are too narrow for likely future usage.
- If you want, I can turn these into a prioritized remediation plan with effort estimates and a staged migration path.
