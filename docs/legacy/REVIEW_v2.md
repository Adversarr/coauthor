# Architectural Review & Technical Debt (v2)

Date: 2026-02-08  
Role: Lead Architect review  
Status: Consolidated review + survey (non-destructive; source docs unchanged)

## Version History

- **v2 (2026-02-08)**: Re-composed from [REVIEW.md](docs/REVIEW.md) and [TECHNICAL_DEBT_SURVEY.md](docs/TECHNICAL_DEBT_SURVEY.md). Preserves the mature “last commit” review analysis, and appends the broader technical debt survey as structured, categorized backlog with resolution notes where already implemented.
- **v1 (2026-02-07 .. 2026-02-08)**: Original documents:
  - [REVIEW.md](docs/REVIEW.md): Diff-based review of the last commit.
  - [TECHNICAL_DEBT_SURVEY.md](docs/TECHNICAL_DEBT_SURVEY.md): Repository-wide technical debt survey.

## Table of Contents

- [Scope](#scope)
- [Priority Legend](#priority-legend)
- [Part A — Code Review (Last Commit)](#part-a--code-review-last-commit)
  - [Summary](#part-a-summary)
  - [Findings (Ordered by Severity)](#part-a-findings-ordered-by-severity)
  - [Suggested Audit Logging Strategy](#part-a-suggested-audit-logging-strategy)
  - [Test Gaps](#part-a-test-gaps)
  - [Next Steps (Optional)](#part-a-next-steps-optional)
- [Part B — Technical Debt Survey (Repository-Wide)](#part-b--technical-debt-survey-repository-wide)
  - [Survey Summary](#part-b-survey-summary)
  - [Active Technical Debt (Remaining)](#part-b-active-technical-debt-remaining)
  - [Resolved / Informational (P4)](#part-b-resolved--informational-p4)
  - [Notes](#part-b-notes)

## Scope

This document covers:

- **Diff-based review**: the last commit (`HEAD~1..HEAD`) as captured in [REVIEW.md](docs/REVIEW.md).
- **Repository-wide survey**: `src/`, `docs/`, `tests/`, `scripts/`, `demo/`, and root configs as captured in [TECHNICAL_DEBT_SURVEY.md](docs/TECHNICAL_DEBT_SURVEY.md) (generated directories excluded: `node_modules/`, `dist/`, `coverage/`).

This v2 file is intentionally **additive**: it does not delete the mature analysis from the original review; instead it preserves it and adds the broader survey context and resolution tracking.

## Priority Legend

- **P0**: Immediate correctness or data-loss risk in current usage.
- **P1**: High risk to reliability/scalability as usage grows or adapters multiply.
- **P2**: Medium risk that increases integration or evolution cost.
- **P3**: Low risk; mostly maintainability or cleanliness.
- **P4**: Resolved or informational only.

---

## Part A — Code Review (Last Commit)

This section preserves (with only light normalization) the existing “last commit” review analysis.

<a id="part-a-summary"></a>

### Summary

The refactor moves EventStore/AuditLog/ConversationStore to async I/O with in‑process locking and write‑through caches. This is a solid direction for non‑blocking performance. The key remaining risks are:

- Audit logging calls are now async but are not awaited, which can drop entries or surface unhandled rejections.
- Cache initialization races can lose entries if appends happen before the cache loads.
- The new locking model only protects a single process; with multiple processes it is unsafe.

Given the clarification that **single writer is acceptable**, the multi‑process risk is acceptable **as long as it is documented or enforced**.

<a id="part-a-findings-ordered-by-severity"></a>

### Findings (Ordered by Severity)

#### [P1] Unawaited Audit Writes (Data Loss / Unhandled Rejection Risk)

**Where**
- `src/infra/toolExecutor.ts:25-93`
- `src/domain/ports/tool.ts:171-192`
- `src/agents/outputHandler.ts:260-271`

**Issue**
`AuditLog.append()` is now async, but `DefaultToolExecutor.recordRejection()` and `execute()` call it without `await`. This can:

- drop audit entries if the process exits soon after,
- surface unhandled promise rejections,
- produce log ordering issues under load.

**Recommendation**
Pick a clear policy for audit logging (see [Suggested Audit Logging Strategy](#part-a-suggested-audit-logging-strategy)). The cleanest fix is to:

- make `ToolExecutor.recordRejection()` async (`Promise<ToolResult>`),
- await all `auditLog.append()` calls in `recordRejection()` and `execute()`.

If choosing best‑effort logging (non‑blocking), explicitly `void auditLog.append(...).catch(...)` so rejections are handled and intent is clear.

---

#### [P1] Cache Initialization Race (Potential Data Loss In‑Process)

**Where**
- `src/infra/jsonlEventStore.ts:226-234`
- `src/infra/jsonlAuditLog.ts:124-131`
- `src/infra/jsonlConversationStore.ts:161-165`

**Issue**
`#ensureCacheLoaded()` runs without a mutex or single‑flight guard. If two appends occur before the first cache load finishes, the later cache load can overwrite in‑memory state and drop recent entries or regress max IDs.

**Recommendation**
Add a single‑flight load promise, or perform cache loading under the same mutex used for writes. This ensures “load then append” is serialized even under concurrent requests.

---

<a id="part-a-single-process-assumption"></a>

#### [P2] Single‑Process Assumption (Operational Constraint)

**Where**
- `src/infra/asyncMutex.ts:4-9`

**Issue**
`AsyncMutex` only serializes operations within one Node process. With multiple processes (e.g., multiple CLI/TUI instances) the JSONL files and caches can diverge, leading to corrupted sequences or missed events.

**Recommendation**
Since single writer is acceptable, document this operational constraint explicitly. If multi‑process support is needed later, add inter‑process locking or move to a DB.

---

<a id="part-a-suggested-audit-logging-strategy"></a>

### Suggested Audit Logging Strategy

Two strategies are viable:

### Option A (Recommended): Strict / Durable Audit Logging

**When to use**: reliable and ordered audit logs, even under failures.

**Behavior**
- `auditLog.append()` is awaited everywhere.
- If an audit write fails, surface the error or include it in telemetry.
- Tool execution waits for audit writes to complete.

**Pros**
- Strong traceability and compliance.
- Deterministic ordering and visibility.

**Cons**
- Slightly higher latency per tool call.

**Implementation Sketch**
- Change `ToolExecutor.recordRejection()` to `async` and return `Promise<ToolResult>`.
- Await all `auditLog.append()` calls in both `recordRejection()` and `execute()`.
- Update call sites (`OutputHandler.handleRejections`, etc.) to `await` the rejection call.

---

### Option B: Best‑Effort / Non‑Blocking Audit Logging

**When to use**: maximum throughput; tolerate missing audit entries.

**Behavior**
- Do not await `auditLog.append()`.
- Explicitly `void` the promise and catch errors.

**Pros**
- Minimal impact on tool execution latency.

**Cons**
- Audit logs may be incomplete or out of order.

**Implementation Sketch**

```ts
void this.#auditLog.append(...).catch((err) => {
  // record to telemetry or console
})
```

---

### Recommended Choice

Given the “small team, single writer” constraint and the purpose of audit logs, Option A (Strict / Durable) is recommended to keep the audit trail trustworthy and predictable. The performance impact should be negligible at this scale.

### Additional Notes

- The async store approach is a good improvement for responsiveness.
- Persisting conversation history per task is a strong foundation for recovery and UIP resumption.

<a id="part-a-test-gaps"></a>

### Test Gaps

- Concurrency tests for `append()` before cache initialization across EventStore/AuditLog/ConversationStore.
- If multi‑process support is revisited, a two‑process integration test validating ordering and visibility.

<a id="part-a-next-steps-optional"></a>

### Next Steps (Optional)

If desired, implement:

1. Strict audit logging (async `recordRejection`, awaited appends, updated call sites).
2. Single‑flight cache initialization for all JSONL stores.
3. A short operational note clarifying “single‑writer” constraints.

---

## Part B — Technical Debt Survey (Repository-Wide)

This section adapts the survey into an explicit backlog with “Active vs Resolved” categorization, while retaining the original survey’s intent and detail.

<a id="part-b-survey-summary"></a>

### Survey Summary

The architecture largely follows the intended hexagonal/Event Sourcing design, but several core boundaries are bypassed, validation is deferred to projections, and the storage/eventing layer assumes a single-process runtime. The result is a system that will be hard to scale to multiple adapters/processes and will accumulate brittle, inconsistent state as event volume grows.

<a id="part-b-active-technical-debt-remaining"></a>

### Active Technical Debt (Remaining)

#### [P2] Event store and projections assume single-process execution

**Paths**: `src/infra/jsonlEventStore.ts`, `src/application/projector.ts`, `src/agents/runtimeManager.ts`, `src/tui/main.tsx`  
**Risk**: Events are streamed through an in-memory stream and UI/runtime refresh is tied to in-process subscriptions; external writers will not trigger runtime execution or UI refresh. Projection state is read/updated without cross-process coordination. This blocks scaling to multiple adapters or processes and creates race conditions in shared workspaces.  
**Current state**: The system is safer *within a single process* due to in-process locking, but remains multi-process unsafe; see Part A’s [Single‑Process Assumption](#part-a-single-process-assumption).

#### [P2] Polling-based interaction waits and repeated stream scans

**Paths**: `src/application/interactionService.ts`, `src/application/taskService.ts`  
**Risk**: `waitForResponse` polls the event store and repeatedly scans streams. This is wasteful under load and won’t scale with larger event volumes or many concurrent tasks.

#### [P2] Conversation recovery replays “safe” tool calls without stronger guarantees

**Paths**: `src/agents/conversationManager.ts`, `src/domain/ports/tool.ts`  
**Risk**: Recovery re-executes any tool marked `safe`. If a tool is misclassified or evolves to have side effects, recovery can introduce duplicate actions. Risk grows as the tool catalog expands.

#### [P3] Duplicate prompt-building logic with inconsistent behavior

**Paths**: `src/application/contextBuilder.ts`, `src/agents/defaultAgent.ts`  
**Risk**: Two prompt-building paths encode overlapping responsibilities with different content, enabling prompt drift and inconsistent agent behavior.

#### [P3] Debug logging leaks into core runtime paths

**Paths**: `src/agents/conversationManager.ts`, `src/infra/openaiLLMClient.ts`  
**Risk**: Unstructured console logging in core services can pollute CLI/TUI output and complicate troubleshooting. Lack of structured logging/levels reduces maintainability and observability.

<a id="part-b-resolved--informational-p4"></a>

### Resolved / Informational (P4)

#### [P4] Port boundary bypass for filesystem access (Resolved 2026-02-08)

**Paths**: `src/domain/ports/artifactStore.ts`, `src/infra/fsArtifactStore.ts`, `src/application/contextBuilder.ts`, `src/infra/tools/readFile.ts`, `src/infra/tools/editFile.ts`, `src/infra/tools/listFiles.ts`  
**Resolution**: Refactored `ArtifactStore` to support `exists`, `mkdir`, `stat`. Updated `FsArtifactStore` to implement strict path validation (preventing traversal) and replaced all direct `fs` usage in `ContextBuilder` and Tools with `ArtifactStore` methods. Added `docs/SECURITY.md` and security tests.

#### [P4] Architectural spec drift between docs and implementation (Resolved 2026-02-07)

**Paths**: `docs/DOMAIN.md`, `docs/ARCHITECTURE.md`, `src/domain/events.ts`, `src/application/taskService.ts`  
**Resolution**: Updated `docs/DOMAIN.md` and `docs/ARCHITECTURE.md` to include `TaskPaused`, `TaskResumed`, and `TaskInstructionAdded` in the V0.2 event set and workflow. The documented lifecycle now matches the implementation.

#### [P4] Domain ports depend directly on RxJS (Resolved 2026-02-08)

**Paths**: `src/domain/ports/eventStore.ts`, `src/domain/ports/auditLog.ts`, `src/domain/ports/uiBus.ts`, `src/domain/ports/subscribable.ts`  
**Resolution**: Introduced a framework-agnostic `Subscribable` interface in `src/domain/ports/subscribable.ts`. Domain ports now depend on `Subscribable` instead of RxJS directly; infrastructure implementations may still use RxJS internally.

#### [P4] Event validation and state transitions are enforced only in projections (Resolved 2026-02-07)

**Paths**: `src/application/taskService.ts`, `src/application/projector.ts`, `src/agents/runtime.ts`, `src/infra/jsonlEventStore.ts`, `src/domain/events.ts`  
**Resolution**: Implemented explicit state transition checks in `TaskService` (`canTransition()`), so key commands validate task state before appending events. This reduces invalid event sequences and keeps the event log closer to domain rules.

#### [P4] JSONL stores use full-file reads and synchronous I/O on hot paths (Resolved 2026-02-08)

**Paths**: `src/infra/jsonlEventStore.ts`, `src/infra/jsonlConversationStore.ts`, `src/infra/jsonlAuditLog.ts`  
**Resolution**: Refactored JSONL stores to use asynchronous file I/O and write-through caches to avoid repeated full-file reads on common paths.

#### [P4] Conversation and audit stores lack locking and atomicity guarantees (Resolved 2026-02-08)

**Paths**: `src/infra/jsonlConversationStore.ts`, `src/infra/jsonlAuditLog.ts`, `src/infra/asyncMutex.ts`  
**Resolution**: Added `AsyncMutex` for in-process write serialization. Projection writes use a “write-to-tmp then rename” pattern for atomic updates.

#### [P4] Read-path fragility on malformed rows (Resolved 2026-02-08)

**Paths**: `src/infra/jsonlEventStore.ts`, `src/infra/jsonlAuditLog.ts`  
**Resolution**: JSONL readers now skip malformed/partial rows during parsing so a single bad line does not break reads for the entire store.

<a id="part-b-notes"></a>

### Notes

- The items above are technical debt rather than immediate defects. They indicate where design intent and implementation are misaligned or where scalability assumptions are narrower than likely future usage.
- This v2 document does not replace operational decisions; it documents current constraints (notably the single-writer/single-process assumption) and the remaining backlog.
