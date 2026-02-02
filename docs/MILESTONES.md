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
- [x] JsonlEventStore 实现
- [x] 基本 Projection（TasksProjection, ThreadProjection）
- [x] Projector 增量更新机制
- [x] CLI 基础命令：task create/list, thread open, patch propose/accept
- [x] Patch 应用到文件（applyUnifiedPatch）
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
│       └── eventStore.ts  # EventStore 接口 ✅
├── application/
│   ├── taskService.ts     # Task 用例封装 ✅
│   ├── patchService.ts    # Patch 用例封装 ✅
│   ├── eventService.ts    # Event 回放服务 ✅
│   ├── projector.ts       # Projection runner ✅
│   └── threadProjection.ts # Thread 投影 ✅
├── infra/
│   └── jsonlEventStore.ts # JSONL 实现 ✅
├── cli/
│   ├── run.ts             # CLI 入口 ✅
│   └── io.ts              # I/O 工具 ✅
├── tui/
│   ├── main.tsx           # TUI 组件（可选）✅
│   └── run.ts
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

## M1：LLM 集成基础 🚧 当前目标

> **目标**：添加 LLM 抽象层和基础 Agent 运行时，为 M2 端到端 Workflow 做准备

### 完成标准

- [ ] **LLMClient 端口定义**
  - 创建 `src/domain/ports/llmClient.ts`
  - 定义 `LLMClient` 接口（generate, stream 方法）
  - 支持 fast/writer/reasoning profiles
  
- [ ] **LLM 适配器实现**
  - 创建 `src/infra/anthropicLLMClient.ts`（Claude）
  - 可选：`src/infra/openaiLLMClient.ts`（OpenAI）
  
- [ ] **基础 AgentRuntime**
  - 创建 `src/agents/runtime.ts`
  - 实现 Agent 生命周期管理（start/stop）
  - 实现任务订阅机制

- [ ] **ContextBuilder 服务**
  - 创建 `src/application/contextBuilder.ts`
  - 实现文件内容读取
  - 实现 prompt 上下文构建

- [ ] **投影优化（TD-3）**
  - 实现投影 checkpoint 持久化
  - 实现增量更新机制

- [ ] **新增必需事件**
  - `AgentPlanPosted`: Agent 发布执行计划
  - `UserFeedbackPosted`: 用户对计划/补丁的反馈

- [ ] **更新测试**
  - 测试 LLMClient 接口（使用 mock）
  - 测试 ContextBuilder
  - 测试 AgentRuntime 基础功能

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

> **说明**：M0 已完成架构规范化（Domain/Application 层），M1 聚焦 LLM 集成

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
