# 修复计划：移除 UIP `confirm_task`，任务启动即运行

## 背景与根因

当前实现把“开始执行前确认任务”的交互硬编码进默认 Agent：
- [defaultAgent.ts:L38-L65](file:///Users/yangjerry/Repo/coauthor/src/agents/defaultAgent.ts#L38-L65)

这会导致：
- 任务刚进入执行流程就被 UIP 阻塞，必须等待用户点击 `Proceed/Cancel` 才能继续；
- `TaskStarted` 已经被写入事件流（[runtime.ts:L153-L168](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L153-L168)），但任务随后又进入 `awaiting_user`（[taskService.ts:L158-L179](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L158-L179)），出现“已 started 但暂停等待确认”的语义冲突；
- 文档将 `confirm_task` 作为“标准必经步骤”固化（[ARCHITECTURE.md:L341-L350](file:///Users/yangjerry/Repo/coauthor/docs/ARCHITECTURE.md#L341-L350)），测试也对其做了断言（[agentRuntime.test.ts:L58-L102](file:///Users/yangjerry/Repo/coauthor/tests/agentRuntime.test.ts#L58-L102)），导致实现难以演进到“自动运行、按需交互”的工作流。

## 修复目标（统一口径）

### 1) 事件流（单 Task）

目标顺序：
- `TaskCreated`
- `TaskStarted`
- `UserInteractionRequested` / `UserInteractionResponded`（仅在真正需要用户输入/决策/风险确认时出现，例如 `confirm_risky_action`）
- `TaskCompleted` | `TaskFailed` | `TaskCanceled`

禁止出现：
- `UserInteractionRequested(purpose=confirm_task)`

### 2) 状态机（TaskView.status）

保持简洁：
- `open → in_progress → awaiting_user → done/failed/canceled`

约束：
- `awaiting_user` 仅由真实 UIP 触发（例如缺信息、需决策、风险动作确认），不再用于“开始前确认”。

### 3) 关于 `TaskClaimed`

MVP 阶段不引入 `TaskClaimed` 事件与 `claimed` 状态。
`TaskStarted` 是唯一的“任务已被接管并开始运行”的语义标记。

## 修复策略（分层）

### A. docs/：先统一规格

- 删除/改写所有 `confirm_task → loop until done` 的描述，统一为 `TaskStarted → loop until done（按需 UIP）`。
- 删除 `TaskClaimed/claimed` 的扩展描述，避免和本次“保留 start、去掉 claim”的设计冲突。

受影响文件（计划变更点）：
- [ARCHITECTURE.md](file:///Users/yangjerry/Repo/coauthor/docs/ARCHITECTURE.md)：更新标准 workflow。
- [DOMAIN.md](file:///Users/yangjerry/Repo/coauthor/docs/DOMAIN.md)：删除 UIP purpose 中的 `confirm_task`，更新状态机与扩展点。
- [ARCHITECTURE_DISCUSSION_2026-02-03.md](file:///Users/yangjerry/Repo/coauthor/docs/ARCHITECTURE_DISCUSSION_2026-02-03.md)：同步示例事件流。
- [M2_STATUS.md](file:///Users/yangjerry/Repo/coauthor/docs/M2_STATUS.md)、[MILESTONES.md](file:///Users/yangjerry/Repo/coauthor/docs/MILESTONES.md)：同步验收口径。

### B. src/：删除 confirm_task 的生产路径

- [events.ts](file:///Users/yangjerry/Repo/coauthor/src/domain/events.ts)：从 `InteractionPurposeSchema` 删除 `confirm_task`。
- [defaultAgent.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/defaultAgent.ts)：移除“Initial Confirmation”，任务启动后直接进入 tool loop。
- [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts)：保留 UIP 对 `awaiting_user` 的投影逻辑，但该状态仅由真实 UIP 触发。

### C. tests/：对齐新行为

- [agentRuntime.test.ts](file:///Users/yangjerry/Repo/coauthor/tests/agentRuntime.test.ts)：删除对 `confirm_task` 的断言，改为验证 `TaskStarted` 后能自动推进（通常进入 `done` 或继续 `in_progress`；若触发风险动作则进入 `awaiting_user` 但目的为 `confirm_risky_action` 等）。

## 验收标准

- 新任务创建后执行，事件流中不包含 `UserInteractionRequested(purpose=confirm_task)`。
- `awaiting_user` 只会出现在真正需要用户交互的场景（例如 `confirm_risky_action`）。
- docs/src/tests 三目录对 workflow 与状态机描述一致。
- `npm run test` 全量回归测试通过。

## 风险评估与缓解

- 行为变化：失去“开始前人工取消”入口。
  - 缓解：通过 `TaskCanceled` 提供显式取消命令（例如 CLI/TUI 支持取消）。
- 交互变少：用户不再收到“请确认开始”的提示。
  - 缓解：必要的澄清/策略选择仍可通过 `request_info` / `choose_strategy`（按需）实现。
