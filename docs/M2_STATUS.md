# 里程碑 2 (M2) 状态报告：MVP Task 闭环 + UIP + Tool Audit + 通用 Agent

**日期：** 2026年2月4日  
**状态：** 🟡 **部分完成（核心链路已就绪，TUI 的 UIP 渲染仍缺口）**  
**测试覆盖率：** 39/39 测试通过 (100%)  
**测试命令：** `npm run test`

> 口径声明：自 2026-02-03 起，Plan/Patch 不再作为现行协议。DomainEvent 仅包含 Task 生命周期 + UIP；文件修改与命令执行通过 Tool Use + AuditLog 表达。

---

## 执行摘要

M2 的核心目标“Task 闭环 + UIP + Tool Audit + 通用 Agent”已经形成端到端主链路：任务创建 → Agent 确认 → 工具调用/审计 → 用户交互恢复 → 任务完成/失败。当前缺口主要集中在 **UIP 交互的 TUI 渲染与输入** 以及 **风险动作确认的 UI 呈现细节**。总体已具备进入 M2 验收的主体条件，但仍需补齐交互体验与可视化。

---

## M2 完成标准对照

| 完成标准 | 当前状态 | 证据/实现位置 |
|---|---|---|
| 领域事件收敛（仅 Task 生命周期 + UIP） | ✅ 完成 | `src/domain/events.ts` 定义 7 类事件并移除 Plan/Patch |
| 工具审计链路（ToolRegistry/Executor + AuditLog） | ✅ 完成 | `src/infra/toolRegistry.ts`, `src/infra/toolExecutor.ts`, `src/infra/jsonlAuditLog.ts` |
| 高风险动作确认（confirm_risky_action） | ✅ 完成 | `src/agents/defaultAgent.ts` 触发 UIP；`src/infra/toolExecutor.ts` 强制校验 |
| 通用 Agent 骨架（start → loop until done，按需 UIP） | ✅ 完成 | `src/agents/defaultAgent.ts`, `src/agents/runtime.ts` |
| 交互渲染与输入（CLI/TUI） | ⚠️ 部分完成 | CLI 已支持 pending/respond；TUI 仍未渲染 UIP |

---

## 已实现功能列表

1. **DomainEvent 收敛**
   - 仅保留 Task 生命周期 + UIP 事件，符合 M2 口径。

2. **UIP 交互服务**
   - InteractionService 支持发起/查询/响应 UIP 事件，支持 pending 查询。

3. **AgentRuntime 端到端闭环**
   - 支持 TaskCreated 触发、UIP 暂停与恢复、对 Tool Use 的结果注入。

4. **通用 Agent（DefaultCoAuthorAgent）**
   - 自动启动、LLM Tool Loop、风险工具确认、完成与失败收敛。

5. **Tool Use + AuditLog 审计**
   - ToolRegistry / ToolExecutor 完整链路；AuditLog 记录 ToolCallRequested / ToolCallCompleted。

6. **内置工具集**
   - readFile / editFile / listFiles / runCommand，支持风险等级与审计。

7. **LLM 与上下文构建**
   - FakeLLM 保障测试；OpenAI LLM 可用；ContextBuilder 注入 OUTLINE/BRIEF/STYLE（如存在）。

---

## 待完成任务

1. **TUI 渲染 UIP**
   - 当前 TUI 仅支持 task/list 与 log replay，不支持 UIP 交互显示与输入。

2. **高风险动作确认的 UI 呈现强化**
   - confirm_risky_action 的展示需要更明确的 diff / preview（目前仅文本描述）。

3. **AuditLog 可视化入口**
   - CLI/TUI 尚未提供 audit log 的查询命令，排错体验不足。

---

## 技术实现细节

### 1) DomainEvent 收敛（Task + UIP）

```ts
export type DomainEvent =
  | { type: 'TaskCreated'; payload: TaskCreatedPayload }
  | { type: 'TaskStarted'; payload: TaskStartedPayload }
  | { type: 'TaskCompleted'; payload: TaskCompletedPayload }
  | { type: 'TaskFailed'; payload: TaskFailedPayload }
  | { type: 'TaskCanceled'; payload: TaskCanceledPayload }
  | { type: 'UserInteractionRequested'; payload: UserInteractionRequestedPayload }
  | { type: 'UserInteractionResponded'; payload: UserInteractionRespondedPayload }
```

### 2) Tool Use 审计链路

```ts
this.#auditLog.append({
  type: 'ToolCallRequested',
  payload: {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    authorActorId: ctx.actorId,
    taskId: ctx.taskId,
    input: call.arguments as Record<string, unknown>,
    timestamp: startTime
  }
})
```

### 3) 风险操作强制确认

```ts
if (tool.riskLevel === 'risky' && !ctx.confirmedInteractionId) {
  return {
    toolCallId: call.toolCallId,
    output: { error: `Tool '${call.toolName}' is risky...` },
    isError: true
  }
}
```

### 4) Agent Workflow（start → tool loop，按需 UIP）

```ts
if (context.conversationHistory.length === 0) {
  context.persistMessage({ role: 'system', content: systemPrompt })
  context.persistMessage({ role: 'user', content: buildTaskPrompt(task) })
}
```

---

## 测试覆盖率

**整体情况：** 39/39 测试通过 (100%)  
**测试命令：** `npm run test`  
**覆盖率报告：** 未生成（如需覆盖率执行 `npm run coverage`）

| 测试模块 | 覆盖范围 |
|---|---|
| AgentRuntime | 任务启动、UIP 暂停/恢复执行、持久化对话 |
| InteractionService | UIP 请求/响应与 pending 查询 |
| ConversationStore | JSONL 持久化与恢复 |
| ContextBuilder | 系统 prompt + 文件片段注入 |
| CLI/TUI | 基础命令与最小渲染路径 |

---

## 性能指标

当前未建立正式基准测试。已知实现特性如下：

- EventStore/AuditLog/ConversationStore 均采用 JSONL append，写入开销低、读取需全量解析。
- AgentRuntime 以 events$ 订阅驱动，避免轮询。
- 工具执行为同步调用（runCommand 以 execSync 运行）。

建议在 M2 收尾阶段补充以下指标：

- 事件回放吞吐（events.jsonl 规模增长下的延迟）
- AuditLog 查询与过滤速度
- LLM 交互回合数与任务耗时分布

---

## 已知问题与风险

1. **TUI 无 UIP 渲染与交互输入**
   - 影响：M2 验收需 CLI 承担主要交互路径。

2. **风险操作确认缺少 diff/preview**
   - 影响：用户确认风险动作的可解释性不足。

3. **AuditLog 无 CLI/TUI 可视入口**
   - 影响：排障成本高，审计链路虽有但不易被访问。

4. **工具写入冲突提示有限**
   - 影响：editFile 仅返回冲突文本，需要 UIP 层引导更明确的恢复策略。

---

## 下一步计划（M2 详细计划）

### 阶段划分与目标

| 阶段 | 目标 | 关键产出 | 验证方式 |
|---|---|---|---|
| M2-A 交互闭环完善 | UIP 在 CLI/TUI 可用 | CLI/TUI 交互路径完整 | 交互脚本 + 手工验证 |
| M2-B 风险确认增强 | 风险操作可解释 | diff/preview 展示 | 演示场景 + 审计日志 |
| M2-C 审计与诊断 | 审计查询可用 | audit list 入口 | CLI 输出校验 |
| M2-D 质量基线 | 测试/覆盖率基线 | coverage 报告 | `npm run coverage` |

### 具体任务清单

1. **TUI UIP 渲染与输入**
   - 新增 UIP 视图：展示 pending 列表、当前交互内容、可选项与输入框
   - 增加交互命令：在 TUI 内完成 `respond`（confirm/select/input）
   - 与 CLI 行为对齐：显示 interactionId、purpose、options
   - 验证：TUI 完成 request_info/choose_strategy 与 confirm_risky_action 全流程

2. **风险确认展示增强**
   - editFile：展示将要替换的片段与新片段（diff/preview）
   - runCommand：展示命令、工作目录、超时参数
   - 与 UIP display.contentKind 对齐（Diff/PlainText）
   - 验证：在确认 UI 中可读性达到“无需查看日志即可决策”

3. **AuditLog 查询入口**
   - CLI 新命令：`audit list [taskId]`（输出最近 N 条）
   - TUI 可选：加入“最近审计事件”区块
   - 输出字段：toolCallId、toolName、taskId、isError、durationMs
   - 验证：与 `audit.jsonl` 内容一致

4. **覆盖率与质量基线**
   - 运行 `npm run coverage` 生成基线
   - 记录覆盖率摘要到本报告
   - 若覆盖率低于阈值，补齐关键路径测试

### 里程碑验收清单（M2）

- UIP：CLI 与 TUI 均可完成 request_info/choose_strategy 与 confirm_risky_action
- 风险操作确认：editFile/runCommand 均有可读预览
- 审计链路：ToolCallRequested/Completed 可通过 CLI 查询
- 任务闭环：start → tool loop → done/failed 全流程可复现

---

## 验收路径（建议）

```bash
# 1. 创建任务
npm run dev -- task create "把这段改得更学术一点" --file chapters/01_intro.tex --lines 10-20

# 2. 启动 Agent
npm run dev -- agent start

# 3. 查询 pending UIP 并响应
npm run dev -- interact pending
# 若出现需要用户输入/决策的 UIP（request_info/choose_strategy），响应对应 option 或输入
npm run dev -- interact respond <taskId> <option_id>

# 4. 若出现高风险工具调用，确认
npm run dev -- interact respond <taskId> approve
```
