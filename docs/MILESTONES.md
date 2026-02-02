# CoAuthor 里程碑计划

> 版本：V0  
> 最后更新：2026-02-02  
> 状态：计划文档（可变）

---

## 总览

```
V0 = M0 + M1 + M2 + M3 + M4
V1 = V0 + TODO 异步池 + Background Scheduler + Overleaf 插件接口
```

### 里程碑依赖图

```
M0 ────→ M1 ────→ M2
          │
          └────→ M3
                  │
                  └────→ M4
```

---

## M0：Billboard 基础闭环 ✅ 已完成

> **目标**：核心 Event Sourcing 和 CLI 脚手架，无 LLM 也能跑

### 完成标准

- [x] EventStore 接口定义（Port）
- [x] SqliteEventStore 实现
- [x] JsonlEventStore 实现
- [x] 基本 Projection（TasksProjection, ThreadProjection）
- [x] Projector 增量更新机制
- [x] CLI 基础命令：task create/list, thread open, patch propose/accept
- [x] Patch 应用到文件（applyUnifiedPatch）
- [x] 日志回放（log replay）

### 已实现目录结构

```
src/
├── core/
│   ├── domain.ts          # Event schema（需扩展）
│   ├── eventStore.ts      # EventStore 接口
│   ├── operations.ts      # 临时的操作函数（待重构）
│   ├── projections.ts     # Projection reducers
│   └── projector.ts       # Projection runner
├── infra/
│   ├── sqliteEventStore.ts
│   ├── jsonlEventStore.ts
│   └── sqlite.ts
├── cli/
│   ├── run.ts
│   └── io.ts
└── patch/
    └── applyUnifiedPatch.ts
```

### 遗留问题（M1 解决）

| 问题 | 影响 |
|------|------|
| 缺少 `authorActorId` | 事件不知道谁触发的 |
| 缺少 Application 层 | CLI 直接调用 core，难以复用 |
| Event 类型不完整 | 与 DOMAIN.md 规范有差距 |

---

## M1：架构规范化 + Application 层 🚧 当前目标

> **目标**：对齐 ARCHITECTURE.md 和 DOMAIN.md 规范，为 LLM 集成做准备

### 完成标准

- [ ] **扩展 Event Schema**
  - 增加 `authorActorId` 到所有现有事件
  - 新增必需事件：`TaskClaimed`, `AgentPlanPosted`, `PatchAccepted`, `UserFeedbackPosted`
  
- [ ] **添加 Actor 类型**
  - 创建 `src/domain/actor.ts`
  - 定义 Actor, ActorKind, ActorCapability
  
- [ ] **提取 Application 层**
  - 创建 `src/application/` 目录
  - 迁移 operations.ts 到 UseCases
  - 创建 `TaskService`, `PatchService` 封装

- [ ] **重构目录结构**
  ```
  src/
  ├── domain/
  │   ├── actor.ts
  │   ├── task.ts
  │   ├── artifact.ts
  │   ├── events.ts        # 从 core/domain.ts 迁移
  │   └── ports/
  │       └── eventStore.ts
  ├── application/
  │   ├── taskService.ts
  │   ├── patchService.ts
  │   └── services/
  │       └── contextBuilder.ts
  ├── infrastructure/      # 从 infra/ 重命名
  └── interfaces/          # 从 cli/ 和 tui/ 合并
  ```

- [ ] **更新测试**
  - 测试新的 Event schema
  - 测试 Application 层 UseCases

### 验收测试

```bash
# 创建任务（带 authorActorId）
npm run dev -- task create "Test task"
# 查看事件日志，确认有 authorActorId
npm run dev -- log replay
```

---

## M2：端到端 LLM Workflow

> **目标**：像 Claude Code 一样：用户一句话 → Agent 给计划 → 给 diff → 用户确认 → 文件更新

### 完成标准

- [ ] **LLMClient 端口定义**
  - 定义 `LLMClient` 接口
  - 支持 fast/writer/reasoning profiles
  - 支持流式输出

- [ ] **AgentRuntime 实现**
  - 创建 `src/agents/runtime.ts`
  - 实现 workflow 骨架：claim → context → plan → patch → wait review

- [ ] **DefaultCoAuthorAgent**
  - 创建 `src/agents/defaultAgent.ts`
  - 实现完整的 plan + patch workflow
  - 输出 `AgentPlanPosted` 和 `PatchProposed` 事件

- [ ] **CLI 集成**
  - `/ask` 命令触发 Agent
  - 显示 plan + diff
  - `/accept` 和 `/reject` 命令

- [ ] **ContextBuilder**
  - 读取 OUTLINE.md（如存在）
  - 读取相关段落
  - 构建 prompt context

### 验收测试

```bash
# 用户发起请求
npm run dev -- task create "把这段改得更学术一点" --file chapters/01_intro.tex --lines 10-20
# Agent 输出 plan
# Agent 输出 patch（diff）
# 用户确认
npm run dev -- patch accept <taskId> latest
# 文件更新
```

---

## M3：Drift 检测与 Rebase

> **目标**：用户在 Agent 工作期间手动改文件，系统不会盲目覆盖

### 完成标准

- [ ] **FileWatcher 实现**
  - 监控 `*.tex`, `OUTLINE.md`, `assets/`
  - 产生 `ArtifactChanged` 事件

- [ ] **DriftDetector 服务**
  - 对比 `task.baseRevisions` 与当前文件版本
  - 检测到 drift 时标记任务

- [ ] **Rebase 机制**
  - 产生 `TaskNeedsRebase` 事件
  - Agent 自动 rebase（重新读取文件，重新生成 patch）
  - 在 plan 中说明发生了 drift

- [ ] **Patch Apply 校验**
  - Apply 前检查 baseRevision 是否匹配
  - 不匹配则拒绝并提示

### 验收测试

```bash
# 创建任务
npm run dev -- task create "改进这段" --file test.tex
# 手动修改 test.tex
# Agent 检测到 drift，重新生成 patch
# Patch 基于最新版本
```

---

## M4：OUTLINE / BRIEF / STYLE 上下文注入

> **目标**：改文风、改章节目标等效果显著提升，减少重复

### 完成标准

- [ ] **OUTLINE.md 解析**
  - 解析 Markdown 标题结构
  - 映射到 tex 文件位置

- [ ] **ContextBuilder 增强**
  - 始终注入 OUTLINE.md
  - BRIEF.md 存在时注入（文章做什么、贡献、读者）
  - STYLE.md 存在时注入（语气、术语表、禁用词）

- [ ] **缺失提示**
  - 若 BRIEF.md 不存在，提示用户创建
  - 若 STYLE.md 不存在，提示用户创建

### 验收测试

```bash
# 创建 OUTLINE.md
# 创建任务
npm run dev -- task create "展开第二章"
# Agent 的 context 包含 OUTLINE.md
# 生成的内容与大纲一致
```

---

## V1 预留（明确延后）

以下功能明确延后到 V1：

### TODO Comment 异步池

- `/todo add <file:range> <comment>` 创建 background task
- Scheduler 空闲时自动执行
- TODO 列表视图
- 批量 accept/reject

### Background Scheduler

- 后台任务队列
- 空闲执行策略
- 并发控制

### Overleaf 插件接口

- WebSocket/SSE 事件广播
- 远程 Adapter 协议
- 选区 → artifactRefs 转换

### 资产系统完整化

- 图表元数据强制校验
- 代码资产关联
- VLM 图表描述（但不猜数据）

### 多 Agent 协作

- ReviewerAgent
- InterviewerAgent
- RelatedWorkAgent

---

## 时间估算

| 里程碑 | 预估工时 | 前置依赖 |
|--------|----------|----------|
| M0 | ✅ 完成 | - |
| M1 | 2-3 天 | M0 |
| M2 | 3-5 天 | M1 |
| M3 | 2-3 天 | M1 |
| M4 | 1-2 天 | M2 |

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM API 不稳定 | M2 进度受阻 | 使用 mock LLMClient 开发 |
| Patch 冲突复杂 | M3 实现困难 | V0 采用简单的"拒绝 + 提示"策略 |
| Context 过长 | 成本/质量问题 | 分段策略，只注入相关片段 |
| 事件回放性能 | 大量事件时变慢 | Projection 缓存 + 增量更新 |

---

## 附录：M1 详细任务分解

### 1. 扩展 Event Schema（2-4h）

```typescript
// 修改 domain/events.ts
// 1. 给所有 payload 增加 authorActorId
// 2. 新增事件类型
// 3. 更新 DomainEventSchema union
```

### 2. 添加 Actor 类型（1h）

```typescript
// 创建 domain/actor.ts
// 定义 Actor, ActorKind, ActorCapability
// 导出 Zod schema
```

### 3. 创建 Application 层（3-4h）

```typescript
// 创建 application/taskService.ts
export class TaskService {
  constructor(
    private store: EventStore,
    private currentActorId: string
  ) {}
  
  createTask(title: string, opts?: CreateTaskOptions): Task
  listTasks(): TaskView[]
  claimTask(taskId: string): void
}

// 创建 application/patchService.ts
export class PatchService {
  proposePatch(taskId: string, targetPath: string, patchText: string): PatchProposal
  acceptPatch(taskId: string, proposalId: string): void
  applyPatch(taskId: string, proposalId: string): void
}
```

### 4. 更新 CLI（1-2h）

```typescript
// 修改 cli/run.ts
// 改为调用 Application 层的 Service
// 不再直接调用 core/operations.ts
```

### 5. 更新测试（1-2h）

```typescript
// 更新 tests/eventStore.test.ts
// 更新 tests/projector.test.ts
// 新增 tests/taskService.test.ts
```
