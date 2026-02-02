# 里程碑 1 (M1) 状态报告：LLM 集成准备阶段

**日期：** 2026年2月2日  
**状态：** ✅ **准备阶段完成（Phase 3: M1 准备）**  
**测试覆盖率：** 11/11 测试通过 (100%)

---

## 执行摘要

M1 的“准备阶段”（对应 [M0_STATUS.md](M0_STATUS.md) 的 Phase 3 清单）已完成并验证。系统在不引入外部 LLM API 依赖的前提下，补齐了可持续演进到 M2 的关键底座：**投影 checkpoint 真正生效**、**Patch 并发控制（baseRevision 乐观锁）**、**LLMClient 端口**与**规则化 FakeLLM**、以及可手动触发的 **AgentRuntime + ContextBuilder**。

---

## M1（准备阶段）需求验证

### ✅ 1) 添加投影 checkpoint（TD-3）

**状态：** 完成  
**实现：**
- 通用投影运行器：`src/application/projector.ts`
- Tasks 投影改为走增量 checkpoint：`src/application/taskService.ts`
- JSONL 持久化：`src/infra/jsonlEventStore.ts`（`projections.jsonl` 追加写入）

**验证：**
- `tests/taskServiceProjection.test.ts`：验证 `listTasks()` 会推进 projection cursor 且重复调用不会重复全量 reduce。

---

### ✅ 2) 添加并发控制（TD-4：baseRevision 乐观锁 + newRevision 记录）

**状态：** 完成  
**实现：**
- Patch propose 默认自动记录 `baseRevision`：`src/application/patchService.ts`
- Patch apply 前校验 `baseRevision`，不匹配则拒绝并写入：
  - `PatchRejected`
  - `TaskNeedsRebase`
- Patch apply 成功写入 `newRevision`：`PatchApplied.payload.newRevision`

**验证：**
- `tests/patchConcurrency.test.ts`：
  - baseRevision mismatch 时拒绝 apply 且文件不变
  - apply 成功时 PatchApplied 带 newRevision

---

### ✅ 3) 实现 LLMClient 端口 + 规则化 FakeLLM（稳定测试/验收）

**状态：** 完成  
**实现：**
- LLMClient Port：`src/domain/ports/llmClient.ts`
- FakeLLMClient（规则匹配 + 默认稳定输出）：`src/infra/fakeLLMClient.ts`

**验证：**
- FakeLLMClient 在 AgentRuntime 单测中被使用（见下一节）。

---

### ✅ 4) 实现 AgentRuntime（最小可用）+ ContextBuilder

**状态：** 完成  
**实现：**
- ContextBuilder：`src/application/contextBuilder.ts`
  - 支持 `artifactRefs` 的 `file_range` 片段读取并注入上下文
- AgentRuntime：`src/agents/runtime.ts`
  - `handleTask(taskId)`：构建上下文 → 调用 LLMClient → 解析/降级为 Plan → 写入 `AgentPlanPosted`

**验证：**
- `tests/agentRuntime.test.ts`：验证 `handleTask()` 写入 `AgentPlanPosted` 并更新任务投影的 `currentPlanId`。

---

## CLI 验收路径（准备阶段）

### 1) 创建任务

```bash
npm run dev -- task create "Test task"
```

### 2) 手动触发 Agent 生成计划（使用 FakeLLM）

```bash
npm run dev -- agent handle <taskId>
```

**预期：**
- 输出一个 `plan_<id>` 与 JSON 计划内容
- `log replay <taskId>` 可看到 `AgentPlanPosted`

### 3) 验证并发控制（baseRevision）

```bash
# 提交 patch proposal（自动记录 baseRevision）
npm run dev -- patch propose <taskId> <targetPath> < patch.diff

# 在 apply 前手动改动文件，模拟 drift
# 再 accept 应被拒绝，并提示 baseRevision mismatch
npm run dev -- patch accept <taskId> latest
```

---

## 架构映射（新增/变化点）

### 新增端口与适配器

- **Domain/Ports**
  - `LLMClient`：`src/domain/ports/llmClient.ts`
- **Infrastructure**
  - `FakeLLMClient`：`src/infra/fakeLLMClient.ts`（测试与验收用）

### 新增应用服务与运行时

- **Application**
  - `ContextBuilder`：`src/application/contextBuilder.ts`
- **Agents**
  - `AgentRuntime`：`src/agents/runtime.ts`

### 系统组装与入口

- `createApp()` 现在会组装：
  - `contextBuilder`, `llm`, `agentRuntime`（默认 FakeLLM）
  - 入口：`src/app/createApp.ts`
- CLI 增加 `agent start/stop/handle`：
  - 入口：`src/cli/run.ts`

---

## 结论

M1 准备阶段已具备“可稳定测试、可持续演进”的基础设施。下一步进入 M1 后续 / M2 时，可以在保持端口不变的情况下替换 FakeLLM 为真实 LLM 适配器，并将 `AgentRuntime` 从“手动触发”演进为“订阅任务池的工作流运行器”。
