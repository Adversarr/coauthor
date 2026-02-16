# Seed Vision and Interaction Design

> Version: V1 (post-rebrand)
> Last Updated: 2026-02-16
> Status: Living product and execution design

This document defines Seed as a general personal AI assistant team. A user goal is the seed for planning, execution, delegation, and review.

---

## 0. Positioning

Seed is a local-first orchestration system for completing user goals with multiple assistant roles.

- **User**: defines goals, constraints, and acceptance criteria.
- **Agent Team**:
  - `Coordinator Agent` (`agent_seed_coordinator`) owns end-to-end execution.
  - `Research Agent` (`agent_seed_research`) performs read-only discovery and evidence gathering.
  - `Chat Agent` (`agent_seed_chat`) handles quick advisory responses with no tool access.

Seed is domain-agnostic. It can support writing workflows, but also code changes, project operations, planning, and documentation tasks.

---

## 1. Product Goals

### 1.1 Goals

1. **Goal-driven execution loop**
   - Convert a user goal into explicit tasks/subtasks.
   - Execute through tool loops with replayable event history.
   - Keep progress observable in TUI and Web UI.

2. **Safety and control**
   - Require UIP confirmation for risky tools.
   - Preserve auditable records for tool requests/results.

3. **Reliable runtime model**
   - Single-writer workspace runtime.
   - Event-sourced lifecycle with projection-based reads.
   - Recoverable from process restarts via persisted conversations/events.

4. **Extensible assistant team model**
   - Add agents without changing domain/event fundamentals.
   - Keep agent specialization explicit and testable.

### 1.2 Non-goals

- Autonomous hidden execution without user visibility.
- Multi-workspace distributed runtime ownership in V1.
- Remote production deployment hardening as a primary target.

---

## 2. Interaction Model

### 2.1 Core loop

1. User submits a goal.
2. System creates a task stream.
3. Coordinator executes through LLM + tools + subtasks.
4. Risky action => UIP request.
5. User responds.
6. Task reaches terminal state with summary/failure reason.

### 2.2 UIP contract

- `Select`, `Confirm`, `Input`, `Composite` interaction kinds.
- Responses must match pending interaction ID.
- Stale/duplicate responses are rejected.

### 2.3 Artifact context

Artifacts are optional context pointers (`file_range`, `outline_anchor`, `asset`, `citation`) attached to tasks. They guide execution but are not themselves state transitions.

---

## 3. Data and Runtime

### 3.1 Persistence layout

Workspace-local `.seed/`:
- `events.jsonl`
- `projections.jsonl`
- `audit.jsonl`
- `conversations.jsonl`
- `server.lock`

### 3.2 Runtime modes

- **Master mode**: owns persistence + runtime + HTTP/WS serving.
- **Client mode**: remote adapters for UI processes.

### 3.3 Concurrency and invariants

- Per-task serialization in runtime manager.
- Domain events are append-only and replayable.
- Audit logs remain separate from domain lifecycle state.

---

## 4. Agent Team Responsibilities

### Coordinator Agent

- Default agent for task execution.
- Can use search/edit/exec/subtask tools.
- Plans and delegates to subagents when useful.

### Research Agent

- Read-only tool set (`readFile`, `listFiles`, `glob`, `grep`).
- Produces evidence-backed summaries.

### Chat Agent

- No tools.
- Fast advisory answers and clarification support.

---

## 5. Domain Examples (Optional)

Seed supports multiple domains with the same runtime model:

- Code maintenance and refactoring
- Project planning and operational checklists
- Document drafting and revision
- Research/writing workflows (including academic writing)

Domain specializations should be introduced as prompt/context/tooling layers, not hard-coded into the core orchestration model.

---

## 6. Milestone Direction

### M1 (completed)
- Event store + projections + core task lifecycle.

### M2 (completed)
- Agent runtime, tool loop, UIP safety flow.

### M3 (completed)
- TUI + Web UI parity over shared backend contracts.

### M4 (next)
- Better goal decomposition ergonomics and agent-role controls.
- Stronger runtime observability and diagnostics.
- Optional domain packs (e.g., writing, repo ops, release management).

---

## 7. Acceptance Criteria for Rebrand Completion

- Runtime identifiers use `seed` naming (`seed` CLI, `.seed/`, `SEED_*` env vars).
- Default team roles are coordinator/research/chat with explicit IDs.
- Current docs describe Seed as domain-agnostic assistant-team orchestration.
- Legacy docs remain untouched under `docs/legacy/`.
