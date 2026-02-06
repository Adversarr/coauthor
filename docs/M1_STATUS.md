# Milestone 1 (M1) Status Report: LLM Integration Preparation Phase

**Date:** February 2, 2026  
**Status:** ✅ **M1 Completed (Ready for M2)**  
**Test Coverage:** 29/29 tests passed (100%)

> Disclaimer: This report reflects the implementation and acceptance criteria as of 2026-02-02 (including Plan/Patch related commands and events). Since 2026-02-03, Plan/Patch are no longer the current collaboration protocol: domain events have converged into Task Lifecycle + UIP; file modifications and command executions are expressed through Tool Use + AuditLog. Current `src/` no longer contains patch CLI and Patch* event implementations, so patch/plan related sections in this document are for historical reference only.

---

## Executive Summary

The goal of the M1 phase was to "complete the system foundation without introducing external LLM API dependencies." After a comprehensive code review and refactoring, the system fully complies with the requirements of [ARCHITECTURE.md](ARCHITECTURE.md). The foundational infrastructure (EventSourcing + RxJS, Checkpoint, Persistence) is solid, and the Agent abstraction layer has been finalized, allowing for a smooth transition into M2 (End-to-End LLM Collaboration).

---

## M1 Requirement Verification

### ✅ 1) Projection Checkpoint and Incremental Calculation (TD-3)

**Status:** Completed  
**Implementation:**
- **Incremental Updates**: The Tasks projection list is only fully replayed upon startup, after which it maintains in-memory state and appends checkpoints.
- **File Rewriting**: To prevent `projections.jsonl` from growing indefinitely, snapshotting (file overwrite optimization) during `saveProjection` has been implemented.
- **Verification**: `tests/taskServiceProjection.test.ts` verifies cursor advancement and calculation correctness.

### ✅ 2) Concurrency Control and Drift Prevention (TD-4)

**Status:** Completed  
**Implementation:**
- **Optimistic Locking (Historical)**: `patch propose` automatically captures `baseRevision`.
- **JIT Validation (Historical)**: `patch apply` strictly validates file versions. If versions do not match (e.g., user modified the file in between), the application is rejected and a `PatchConflicted` event is issued.
- **Verification**: `tests/patchConcurrency.test.ts`.

> Note: Under the new direction, conflicts are no longer expressed through DomainEvents like `PatchConflicted`; instead, tool execution failures should be reflected in the AuditLog, and users should be guided to confirm/retry/terminate tasks via UIP.

### ✅ 3) LLMClient Port and FakeLLM

**Status:** Completed  
**Implementation:**
- **Port Definition**: `src/domain/ports/llmClient.ts` defines the standard interface.
- **Mock Implementation**: `src/infra/fakeLLMClient.ts` provides deterministic, rule-based responses for development and testing.
- **Verification**: All integration tests run via FakeLLM, ensuring CI/CD stability.

### ✅ 4) AgentRuntime and Standard Agent Interface

**Status:** Completed  
**Implementation:**
- **Strict Interface**: The `Agent` interface (`canHandle`, `run`, `resume`) is defined in `src/agents/agent.ts` according to the architecture documentation.
- **Reactive Runtime**: `AgentRuntime` (`src/agents/runtime.ts`) has been refactored into a reactive runtime based on RxJS, subscribing to the `events$` stream instead of polling.
- **Default Agent**: `DefaultCoAuthorAgent` implements the standard Claim -> Context -> Confirm/Loop workflow (implementation details at the time might have included plan output, but this is no longer a requirement for the current protocol).
- **Verification**:
  - `tests/agentRuntime.test.ts` verifies task distribution, execution loops, and status updates.
  - `npm run dev -- agent handle <taskId>` can manually trigger the full process.

---

## Architecture and Code Quality Review Summary

In the final review before the end of M1, we performed the following key refactorings to align with the architecture documentation:

1.  **Introduction of RxJS Reactive Streams**:
    - `EventStore` now exposes the `events$` Observable.
    - `AgentRuntime` and `Projector` respond to events by subscribing to the stream, eliminating inefficient polling code.

2.  **Hexagonal Architecture Boundary Strengthening**:
    - Clearly separated `AgentRuntime` (infrastructure/scheduler) and `Agent` (business logic).
    - Runtime is responsible for "how to run," while Agent is responsible for "what to run."

3.  **V0 Simplification**:
    - Removed FileWatcher and DriftDetector (optional features for V1).
    - Conflict detection simplified to JIT baseRevision validation.
    - Optimized the storage format for Projections.

---

## CLI Acceptance Path (Updated)

The system is currently in the M1 completed state. The core chain can be verified through the following commands (historical criteria, including Plan/Patch events and commands, superseded by the new direction on 2026-02-03):

```bash
# 1. Create task (with context reference)
npm run dev -- task create "Refactor class X" --file src/index.ts --lines 10-20

# 2. Start Agent processing (using FakeLLM)
# Will generate plan output and write to event stream (historical)
npm run dev -- agent handle <taskId>

# 3. View generated plan-related events (historical)
npm run dev -- log replay | grep AgentPlanPosted

# 4. Simulate concurrency conflict
# First Propose Patch (historical)
npm run dev -- patch propose <taskId> src/index.ts < my.patch
# Manually modify file src/index.ts
echo "change" >> src/index.ts
# Attempt Apply (should fail)
npm run dev -- patch accept <taskId> latest
```

---

## Next Step: M2 (End-to-End LLM Workflow)

M1 has laid all the foundations. The focus for M2 will be:
1.  **Integration with Real LLMs**: Implement `OpenAILLMClient` / `AnthropicLLMClient`.
2.  **Enhancing Agent Capabilities**: Refine the universal `confirm → loop until done` execution loop and integrate Tool Use + AuditLog (using Patch events is no longer the protocol).
3.  **Prompt Engineering**: Optimize System Prompt and Context assembly strategies.

---

## Architecture TODOs

### ⏳ ArtifactStore Port Implementation

**Priority**: Medium  
**Status**: Pending

Current tool implementations (readFile, editFile, listFiles) directly use the Node.js `fs` API, violating the Ports and Adapters architecture principle.

**Tasks**:
1. Create `src/domain/ports/artifactStore.ts` to define the interface.
2. Create `src/infra/fsArtifactStore.ts` for the implementation.
3. Refactor `src/infra/tools/*.ts` to use the `ArtifactStore` port.
4. Update `src/application/contextBuilder.ts` to use the `ArtifactStore` port.

**Interface Definition** (Reference DOMAIN.md):
```typescript
export interface ArtifactStore {
  readFile(path: string): Promise<string>
  readFileRange(path: string, lineStart: number, lineEnd: number): Promise<string>
  getRevision(path: string): Promise<string>
  listDir(path: string): Promise<string[]>
  writeFile(path: string, content: string): Promise<void>
}
```

**Benefits**:
- Follows Hexagonal Architecture
- Facilitates testing (can be replaced with an in-memory implementation)
- Facilitates future support for remote storage (e.g., Overleaf API)
