# Fix Plan: Remove UIP `confirm_task`, Task Starts Running Immediately

## Background and Root Cause

The current implementation hardcodes the "confirm task before starting execution" interaction into the default Agent:
- [defaultAgent.ts:L38-L65](file:///Users/yangjerry/Repo/coauthor/src/agents/defaultAgent.ts#L38-L65)

This leads to:
- Task just enters execution flow and is blocked by UIP, must wait for user to click `Proceed/Cancel` to continue;
- `TaskStarted` has already been written to event stream ([runtime.ts:L153-L168](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L153-L168)), but task then enters `awaiting_user` ([taskService.ts:L158-L179](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L158-L179)), creating semantic conflict of "already started but paused waiting for confirmation";
- Documentation solidifies `confirm_task` as "standard required step" ([ARCHITECTURE.md:L341-L350](file:///Users/yangjerry/Repo/coauthor/docs/ARCHITECTURE.md#L341-L350)), tests also assert it ([agentRuntime.test.ts:L58-L102](file:///Users/yangjerry/Repo/coauthor/tests/agentRuntime.test.ts#L58-L102)), making it difficult to evolve implementation to "automatic running, on-demand interaction" workflow.

## Fix Objectives (Unified Standards)

### 1) Event Flow (Single Task)

Target sequence:
- `TaskCreated`
- `TaskStarted`
- `UserInteractionRequested` / `UserInteractionResponded` (only appears when truly needing user input/decision/risk confirmation, e.g. `confirm_risky_action`)
- `TaskCompleted` | `TaskFailed` | `TaskCanceled`

Prohibit:
- `UserInteractionRequested(purpose=confirm_task)`

### 2) State Machine (TaskView.status)

Keep simple:
- `open → in_progress → awaiting_user → done/failed/canceled`

Constraints:
- `awaiting_user` only triggered by real UIP (e.g. missing info, need decision, risk action confirmation), no longer used for "pre-start confirmation".

### 3) About `TaskClaimed`

MVP phase does not introduce `TaskClaimed` event and `claimed` status.
`TaskStarted` is the only semantic marker of "task has been taken over and started running".

## Fix Strategy (Layered)

### A. docs/: First Unify Specifications

- Delete/rewrite all `confirm_task → loop until done` descriptions, unify to `TaskStarted → loop until done (on-demand UIP)`.
- Delete `TaskClaimed/claimed` extension descriptions, avoid conflict with this "keep start, remove claim" design.

Affected Files (Planned Change Points):
- [ARCHITECTURE.md](file:///Users/yangjerry/Repo/coauthor/docs/ARCHITECTURE.md): Update standard workflow.
- [DOMAIN.md](file:///Users/yangjerry/Repo/coauthor/docs/DOMAIN.md): Delete `confirm_task` from UIP purpose, update state machine and extension points.
- [ARCHITECTURE_DISCUSSION_2026-02-03.md](file:///Users/yangjerry/Repo/coauthor/docs/ARCHITECTURE_DISCUSSION_2026-02-03.md): Sync example event flow.
- [M2_STATUS.md](file:///Users/yangjerry/Repo/coauthor/docs/M2_STATUS.md), [MILESTONES.md](file:///Users/yangjerry/Repo/coauthor/docs/MILESTONES.md): Sync acceptance standards.

### B. src/: Delete confirm_task Production Path

- [events.ts](file:///Users/yangjerry/Repo/coauthor/src/domain/events.ts): Delete `confirm_task` from `InteractionPurposeSchema`.
- [defaultAgent.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/defaultAgent.ts): Remove "Initial Confirmation", task starts and directly enters tool loop.
- [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts): Retain UIP projection logic for `awaiting_user`, but this status only triggered by real UIP.

### C. tests/: Align with New Behavior

- [agentRuntime.test.ts](file:///Users/yangjerry/Repo/coauthor/tests/agentRuntime.test.ts): Delete assertions for `confirm_task`, change to verify that after `TaskStarted` can automatically progress (usually enters `done` or continues `in_progress`; if risk action triggered then enters `awaiting_user` but purpose is `confirm_risky_action`, etc.).

## Acceptance Standards

- After new task creation and execution, event stream does not contain `UserInteractionRequested(purpose=confirm_task)`.
- `awaiting_user` only appears in scenarios truly needing user interaction (e.g. `confirm_risky_action`).
- docs/src/tests three directories have consistent descriptions of workflow and state machine.
- `npm run test` full regression test passes.

## Risk Assessment and Mitigation

- Behavior change: Lose "manual cancel before start" entry point.
  - Mitigation: Provide explicit cancel command through `TaskCanceled` (e.g. CLI/TUI supports cancel).
- Fewer interactions: User no longer receives "please confirm start" prompt.
  - Mitigation: Necessary clarification/strategy selection can still be done through `request_info` / `choose_strategy` (on-demand).
