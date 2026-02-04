# CoAuthor 里程碑计划

> 版本：V0.1  
> 最后更新：2026-02-03  
> 状态：计划文档（可变）

---

## 2026-02-03 方向重设（重要）

- Plan/Patch 不再作为现行协作协议与领域事件口径。\n- 当前方向以 Task 闭环 + UIP（通用交互）+ Tool Use 审计（AuditLog）为主线。\n- 旧里程碑中涉及 Plan/Patch 的内容仅作为历史实现参考，不应作为后续里程碑的必经步骤。

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

> 口径说明：本里程碑按 2026-02-02 的旧口径验收完成，其中 Patch 相关条目属于历史实现参考。

### 完成标准

- [x] EventStore 接口定义（Port）
- [x] JsonlEventStore 实现
- [x] 基本 Projection（TasksProjection）
- [x] Projector 增量更新机制
- [x] CLI 基础命令：task create/list（patch propose/accept 为历史口径）
- [x] 文件修改能力验证（历史口径通过 unified diff 管道验证）
- [x] 日志回放（log replay）

### 已实现目录结构

```
src/
├── domain/
│   ├── actor.ts           # Actor, ActorKind, ActorCapability ✅
│   ├── task.ts            # Task 类型定义 ✅
│   ├── artifact.ts        # Artifact 类型定义 ✅
│   ├── events.ts          # 完整 Event schema（含 authorActorId）✅
│   ├── index.ts
│   └── ports/
│       ├── eventStore.ts  # EventStore 接口 ✅
│       ├── auditLog.ts    # AuditLog 接口 ✅
│       ├── conversationStore.ts # ConversationStore 接口 ✅
│       ├── llmClient.ts   # LLMClient 接口 ✅
│       └── tool.ts        # Tool/Registry/Executor 接口 ✅
├── application/
│   ├── taskService.ts     # Task 用例封装 ✅
│   ├── eventService.ts    # Event 回放服务 ✅
│   ├── interactionService.ts # UIP 服务 ✅
│   ├── contextBuilder.ts  # 上下文构建 ✅
│   ├── projector.ts       # Projection runner ✅
│   └── revision.ts        # 内容 revision 辅助 ✅
├── infra/
│   ├── jsonlEventStore.ts # JSONL 实现 ✅
│   ├── jsonlAuditLog.ts   # AuditLog JSONL 实现 ✅
│   ├── jsonlConversationStore.ts # ConversationStore JSONL 实现 ✅
│   ├── toolRegistry.ts    # ToolRegistry 实现 ✅
│   ├── toolExecutor.ts    # ToolExecutor 实现 ✅
│   ├── fakeLLMClient.ts   # Fake LLM ✅
│   ├── openaiLLMClient.ts # OpenAI LLM ✅
│   └── tools/             # 内置工具 ✅
│       ├── readFile.ts
│       ├── editFile.ts
│       ├── listFiles.ts
│       └── runCommand.ts
├── cli/
│   ├── run.ts             # CLI 入口 ✅
│   └── io.ts              # I/O 工具 ✅
├── tui/
│   ├── main.tsx           # TUI 组件（可选）✅
│   └── run.ts
├── agents/
│   ├── agent.ts           # Agent 接口 ✅
│   ├── runtime.ts         # AgentRuntime ✅
│   └── defaultAgent.ts    # 默认 Agent ✅
└── patch/
    └── applyUnifiedPatch.ts # 补丁引擎 ✅
```

### 架构完成度超预期

M0 实际完成的内容超出了原计划，已包含：
- ✅ 完整的 Domain 层（Actor, Task, Artifact, Events）
- ✅ 完整的 Application 层（Services + Projections）
- ✅ 所有事件已包含 `authorActorId`
- ✅ 六边形架构（Port-Adapter）完整实现

### M1 需要补全的组件

| 组件 | 状态 | 说明 |
|------|------|------|
| LLMClient 接口 | ❌ 无 | M1 核心目标 |
| AgentRuntime | ❌ 无 | M1 核心目标 |
| ContextBuilder | ❌ 无 | M1 核心目标 |
| 投影 Checkpoint | ⚠️ 待优化 | TD-3 技术债务 |

---

## M1：LLM 集成准备 ✅ 已完成

> **目标**：补齐系统底座（LLM 抽象、Agent 运行时、投影增量），为后续 MVP 执行闭环做准备。\n> **备注**：该里程碑的历史实现可能包含 Plan/Patch 相关设计，但自 2026-02-03 起不再作为现行协议要求。详见 [M1_STATUS.md](M1_STATUS.md)。

---

## M2：MVP：Task 闭环 + UIP + Tool Audit + 通用 Agent

> **目标**：用户一句话 → Agent 开始执行（TaskStarted）→ 循环推进直到完成；需要用户决策/补信息/高风险动作时统一走 UIP；文件修改与命令执行统一走 Tool Use 并写入 AuditLog。

### 完成标准

- [ ] **领域事件收敛**
  - DomainEvent 仅包含 Task 生命周期 + UIP（不包含 Plan/Patch 事件）
- [ ] **工具审计链路**
  - ToolRegistry/ToolExecutor + Interceptor
  - AuditLog 追加写记录 ToolCallRequested/ToolCallCompleted
- [ ] **高风险动作确认**
  - 写文件/执行命令前触发 `UserInteractionRequested(purpose=confirm_risky_action)`
  - 用户确认后才允许执行工具
- [ ] **通用 Agent 骨架**
  - `start → loop until done`
  - 缺信息/需决策统一走 UIP
- [ ] **交互渲染与输入**
  - CLI/TUI 能渲染 UIP 请求并提交 UIP 响应

### 验收测试

```bash
# 用户发起请求
npm run dev -- task create "把这段改得更学术一点" --file chapters/01_intro.tex --lines 10-20
# Agent 开始执行（TaskStarted）
# 若缺信息/需决策：Agent 发起 UIP（request_info/choose_strategy），用户通过 UIP 响应（UserInteractionResponded）
# 若需要写文件/执行命令：Agent 先发起 UIP 高风险确认（confirm_risky_action，可展示 diff）
# 用户确认后执行 Tool Use，并写入 AuditLog
# 任务完成（TaskCompleted）
```

---

## M3：工具安全与冲突处理（JIT）

> **目标**：用户在 Agent 工作期间手动改文件，系统不会盲目覆盖；冲突以工具失败 + UIP 引导解决，而不是 Patch 事件。

### 设计决策

- ✅ **工具侧 JIT 校验**：写文件类 Tool Use 支持 expectedRevision/原子写入策略；不匹配时直接失败并记录到 AuditLog。
- ✅ **交互侧引导**：Agent 通过 UIP 询问用户下一步（重试/放弃/改策略/终止任务）。
- ❌ **不强依赖 FileWatcher**：不做后台监控作为一致性来源（可选增强仅用于“早停/省 token”）。

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
- 批量确认/拒绝交互请求（UIP）

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
| 工具写入冲突/并发修改 | M3 实现困难 | 工具侧校验 + UIP 确认/重试/终止策略 |
| Context 过长 | 成本/质量问题 | 分段策略，只注入相关片段 |
| 事件回放性能 | 大量事件时变慢 | Projection 缓存 + 增量更新 |

---

## 附录（Deprecated）：旧 M1 任务分解

> **Deprecated**：本附录为 2026-02-02 旧口径下的任务分解，包含 Plan/Patch 等已废弃协议概念；自 2026-02-03 起不再作为里程碑执行口径，仅供历史参考。

### 1. 定义 LLMClient 端口（1-2h）

```typescript
// 创建 src/domain/ports/llmClient.ts
export type LLMProfile = 'fast' | 'writer' | 'reasoning'

export interface LLMClient {
  // 同步生成（等待完整响应）
  generate(
    context: string,
    profile: LLMProfile,
    opts?: GenerateOptions
  ): Promise<string>
  
  // 流式生成（逐 token 返回）
  stream(
    context: string,
    profile: LLMProfile,
    opts?: GenerateOptions
  ): Observable<string>
}

export type GenerateOptions = {
  maxTokens?: number
  temperature?: number
  stopSequences?: string[]
}
```

### 2. 实现 Anthropic LLM 适配器（2-3h）

```typescript
// 创建 src/infra/anthropicLLMClient.ts
import Anthropic from '@anthropic-ai/sdk'

export class AnthropicLLMClient implements LLMClient {
  constructor(
    private apiKey: string,
    private modelMap: Record<LLMProfile, string> = {
      fast: 'claude-3-5-haiku-20241022',
      writer: 'claude-3-5-sonnet-20241022',
      reasoning: 'claude-3-7-sonnet-20250219'
    }
  ) {}
  
  async generate(context: string, profile: LLMProfile): Promise<string> {
    const client = new Anthropic({ apiKey: this.apiKey })
    const response = await client.messages.create({
      model: this.modelMap[profile],
      messages: [{ role: 'user', content: context }],
      max_tokens: 4096
    })
    return response.content[0].text
  }
  
  // TODO: 实现 stream()
}
```

### 3. 实现 ContextBuilder 服务（2-3h）

```typescript
// 创建 src/application/contextBuilder.ts
import { readFileSync } from 'node:fs'
import type { ArtifactRef } from '../domain/index.js'

export class ContextBuilder {
  constructor(private baseDir: string) {}
  
  // 构建任务上下文
  buildTaskContext(task: TaskView): string {
    const parts: string[] = []
    
    // 1. 任务描述
    parts.push(`# Task: ${task.title}\n${task.intent}\n`)
    
    // 2. 读取相关文件片段
    if (task.artifactRefs) {
      for (const ref of task.artifactRefs) {
        const content = this.readArtifact(ref)
        parts.push(`## File: ${ref.path}\n\`\`\`\n${content}\n\`\`\`\n`)
      }
    }
    
    return parts.join('\n')
  }
  
  private readArtifact(ref: ArtifactRef): string {
    const fullPath = path.join(this.baseDir, ref.path)
    const content = readFileSync(fullPath, 'utf-8')
    
    // TODO: 支持 range 裁剪
    return content
  }
}
```

### 4. 实现基础 AgentRuntime（3-4h）

```typescript
// 创建 src/agents/runtime.ts
import type { EventStore, LLMClient } from '../domain/ports/index.js'
import type { TaskView } from '../application/taskService.js'

export class AgentRuntime {
  private isRunning = false
  
  constructor(
    private store: EventStore,
    private llm: LLMClient,
    private agentId: string
  ) {}
  
  // 启动 Agent
  start(): void {
    this.isRunning = true
    console.log(`[Agent ${this.agentId}] Started`)
    // M1: 暂不实现自动订阅，等 M2
  }
  
  // 停止 Agent
  stop(): void {
    this.isRunning = false
    console.log(`[Agent ${this.agentId}] Stopped`)
  }
  
  // 手动处理任务（M1 测试用）
  async handleTask(task: TaskView): Promise<void> {
    console.log(`[Agent] Handling task ${task.taskId}`)
    
    // 1. 构建上下文
    const contextBuilder = new ContextBuilder(process.cwd())
    const context = contextBuilder.buildTaskContext(task)
    
    // 2. 调用 LLM 生成计划
    const plan = await this.llm.generate(
      `${context}\n\nGenerate an execution plan for this task.`,
      'fast'
    )
    
    console.log(`[Agent] Generated plan:\n${plan}`)
    
    // M1: 只打印，不写事件（M2 实现完整 workflow）
  }
}
```

### 5. 投影 Checkpoint 优化（2-3h）

```typescript
// 修改 src/application/projector.ts
// 1. 持久化 checkpoint 到 .coauthor/projections.jsonl
// 2. 从 checkpoint 恢复，只处理新事件
// 3. 定期保存 checkpoint（每 100 事件）

export async function projectWithCheckpoint<S>(
  store: EventStore,
  projectionName: string,
  initialState: S,
  reducer: (state: S, event: StoredEvent) => S
): Promise<S> {
  // 1. 读取 checkpoint
  const checkpoint = await store.loadProjection(projectionName)
  let state = checkpoint?.stateJson ? JSON.parse(checkpoint.stateJson) : initialState
  const fromEventId = checkpoint?.cursorEventId ?? 0
  
  // 2. 只处理新事件
  const events = await store.readAll({ fromId: fromEventId + 1 })
  for (const evt of events) {
    state = reducer(state, evt)
  }
  
  // 3. 保存新 checkpoint
  await store.saveProjection({
    name: projectionName,
    cursorEventId: events[events.length - 1]?.id ?? fromEventId,
    stateJson: JSON.stringify(state)
  })
  
  return state
}
```

### 6. 新增事件类型（1h）

```typescript
// 修改 src/domain/events.ts
// 新增 AgentPlanPosted 事件
export const AgentPlanPostedPayloadSchema = z.object({
  authorActorId: z.string().min(1),
  taskId: z.string().min(1),
  planId: z.string().min(1),
  planText: z.string().min(1),
  estimatedSteps: z.number().int().optional()
})

// 新增 UserFeedbackPosted 事件
export const UserFeedbackPostedPayloadSchema = z.object({
  authorActorId: z.string().min(1),
  taskId: z.string().min(1),
  targetId: z.string().min(1),  // planId or proposalId
  targetType: z.enum(['plan', 'patch']),
  feedbackText: z.string().min(1),
  sentiment: z.enum(['accept', 'reject', 'request_changes']).optional()
})

// 更新 DomainEventSchema union
```

### 7. 更新测试（2-3h）

```typescript
// 新增 tests/llmClient.test.ts（使用 mock）
// 新增 tests/contextBuilder.test.ts
// 新增 tests/agentRuntime.test.ts
// 更新 tests/projector.test.ts（测试 checkpoint）
```

---

### M1 验收测试

```bash
# 1. 启动 Agent Runtime（手动模式）
npm run dev -- agent start

# 2. 创建任务
npm run dev -- task create "改进导论" --file chapters/01_intro.tex

# 3. 手动触发 Agent 处理
npm run dev -- agent handle <taskId>
# 预期：Agent 调用 LLM，输出计划（暂不写事件）

# 4. 验证投影 checkpoint
npm run dev -- task list
# 预期：使用缓存的投影，性能提升

# 5. 验证事件日志
npm run dev -- log replay
# 预期：无新事件（M1 只测试基础设施）
```
