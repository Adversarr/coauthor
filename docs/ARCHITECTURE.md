# CoAuthor 架构设计文档

> 版本：V0  
> 最后更新：2026-02-02  
> 状态：规范文档（Normative）

本文档定义 CoAuthor 的架构设计原则、分层结构、核心概念。是系统设计的"宪法"，所有实现必须遵守。

---

## 1. 设计原则（6 条守则）

### 1.1 所有输入都变成 Task，所有输出都进入事件流

无论用户通过 CLI chat、斜杠命令、未来的 TODO comment、还是 Overleaf 插件发起请求，都统一封装为 **Task**。

所有产出（plan、patch、反馈、状态变化）都作为 **TaskEvent** 写入事件流，形成可审计链路。

### 1.2 Plan-first + Patch-first + Review-first

这是 CoAuthor 区别于一般写作工具的核心协议：

1. **Plan-first**：Agent 在修改任何文本前，必须先输出"修改计划/要点"供用户审阅
2. **Patch-first**：所有文本变更以 patch（diff）形式呈现，而非直接覆盖
3. **Review-first**：Patch 必须经过 Review（用户确认）后才能 Apply

### 1.3 用户随手改文件不会被覆盖

系统必须感知用户对文件的手动修改（通过 FileWatcher + Revision 机制）。

当 Agent 发现文件已被用户修改（drift），必须 rebase 或提示，而非盲目覆盖。

### 1.4 CLI 只是一个适配器

CLI/TUI 只负责：
1. 将用户输入转换为 Task/Event 投递到 Billboard
2. 订阅事件流并渲染

未来接入 Overleaf 插件/Web UI 时，只需新增 Adapter，不影响核心。

### 1.5 Task 不做细分类

Task 本身是通用载体。"这个任务是什么"由 **路由到的 Agent + 该 Agent 的 workflow** 决定。

不用 `TaskType = 'draft' | 'revise' | 'tweak'` 这种强类型枚举。

### 1.6 Actor 一等公民

User 与 LLM Agent 都是 **Actor**。区别仅在于：
- 权限/能力（capabilities）
- 特殊标记（如 User 可最终 Apply Patch）

---

## 2. 分层架构

采用 **Hexagonal Architecture（端口-适配器）** + **Event Sourcing** + **CQRS** 模式。

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Interfaces Layer                       │   │
│  │  (Adapters: CLI REPL / TUI / Overleaf Plugin / Web)     │   │
│  │                                                          │   │
│  │  职责：                                                   │
│  │  - 将外部输入转换为 Task/Event                            │
│  │  - 订阅事件流并渲染 UI                                    │
│  │  - 不包含任何业务逻辑                                     │
│  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│                               ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Application Layer                      │   │
│  │                                                          │   │
│  │  UseCases:                                               │
│  │  - PostTask: 创建任务（直接发送给默认 Agent）           │
│  │  - ClaimTask: Agent 认领任务                             │
│  │  - PostPlan: 发布修改计划                                │
│  │  - ProposePatch: 提议补丁                                │
│  │  - AcceptPatch: 接受并应用补丁                           │
│  │  - RejectPatch: 拒绝补丁（附带理由）                     │
│  │  - PostFeedback: 发布反馈（针对计划或补丁）             │
│  │  - ReplayEvents: 事件回放                                │
│  │                                                          │
│  │  Services:                                               │
│  │  - ContextBuilder: 构建 Agent 上下文                     │
│  │  - DriftDetector: 检测文件漂移                           │
│  │  - Scheduler: 任务调度策略                               │
│  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│                               ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Domain Layer                         │   │
│  │               (Pure Logic, No External Deps)             │   │
│  │                                                          │   │
│  │  Entities:                                               │
│  │  - Actor: 参与者（User / Agent）                         │
│  │  - Task: 任务载体                                        │
│  │  - Thread: 任务讨论串                                    │
│  │  - Artifact: 资产（tex / outline / figure / code）       │
│  │                                                          │
│  │  Events (Zod Schemas):                                   │
│  │  - DomainEvent: 所有事件的 discriminated union           │
│  │  - 见 DOMAIN.md 完整定义                                 │
│  │                                                          │
│  │  Ports (Interfaces):                                     │
│  │  - EventStore: 事件存储接口                              │
│  │  - ArtifactStore: 资产读写接口                           │
│  │  - LLMClient: LLM 调用接口                               │
│  │                                                          │
│  │  Policies (Pure Functions):                              │
│  │  - SchedulerPolicy: 执行优先级规则                       │
│  │  - RebasePolicy: 漂移处理规则                            │
│  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│                               ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Infrastructure Layer                    │   │
│  │                                                          │   │
│  │  EventStore Implementations:                             │   │
│  │  - JsonlEventStore: 当前默认的 JSONL 实现                │
│  │                                                          │   │
│  │  Other Adapters:                                         │
│  │  - FileWatcher: 文件变更监控                             │
│  │  - LLMProviders: Claude/OpenAI/Local 适配               │
│  │  - PatchEngine: Unified Diff 应用引擎                    │
│  │  - LatexCompiler: latexmk 适配                          │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                               +                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Agents Layer                         │   │
│  │           (Parallel to Infrastructure, uses Ports)       │   │
│  │                                                          │   │
│  │  AgentRuntime:                                           │
│  │  - WorkflowRunner: 执行 Agent 工作流                     │
│  │  - ConcurrencyControl: 并发控制（写作类任务单并发=1）    │
│  │                                                          │
│  │  Agents:                                                 │
│  │  - DefaultCoAuthorAgent: V0 默认通用 Agent               │
│  │  - [V1] OrchestratorAgent: 可创建子任务调度其他 Agent    │
│  │  - [V1] SpecialistAgents: 专业领域 Agent                 │
│  │                                                          │
│  │  V0 设计：用户 → Billboard → 默认 Agent（类似 chat）    │
│  │  V1 扩展：OrchestratorAgent 可创建子任务分发给其他 Agent │
│  │                                                          │
│  │  Agent 只依赖 Ports，不直接调用 Infra 实现               │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心概念定义

### 3.1 Actor（参与者）

Actor 是能参与任务协作的主体。User 和 Agent 都是 Actor。

```typescript
type ActorKind = 'human' | 'agent'

type Actor = {
  id: string
  kind: ActorKind
  displayName: string
  capabilities: ActorCapability[]
  defaultAgentId?: string  // 仅 human，未指定时路由到哪个 agent
}

type ActorCapability = 
  | 'apply_patch'      // 可应用补丁到文件
  | 'run_latex_build'  // 可运行 LaTeX 编译
  | 'read_assets'      // 可读取资产
  | 'create_task'      // 可创建任务
  | 'claim_task'       // 可认领任务（Agent 特有）
```

### 3.2 Task（任务）

Task 是统一的任务载体。V0 不做强类型细分，不做路由——所有任务直接发送给默认 Agent。

```typescript
type TaskStatus = 
  | 'open'            // 待处理
  | 'claimed'         // 已被 Agent 认领
  | 'in_progress'     // 执行中
  | 'awaiting_review' // 等待用户审阅
  | 'done'            // 完成
  | 'blocked'         // 被阻塞（如缺少信息）
  | 'canceled'        // 已取消

type TaskPriority = 'foreground' | 'normal' | 'background'

type Task = {
  taskId: string
  title: string            // 任务标题（展示用，必填）
  createdBy: string        // ActorId
  assignedTo?: string      // 当前处理者（Agent 认领后赋值）
  priority: TaskPriority
  status: TaskStatus
  intent: string           // 用户意图（自由文本）
  artifactRefs?: ArtifactRef[]  // 关联的资产/位置
  baseRevisions?: Record<string, string>  // 创建时的文件版本快照
  threadId: string         // 讨论串 ID
  createdAt: string
  parentTaskId?: string    // V1 预留：父任务 ID（子任务支持）
}
```

### 3.3 ArtifactRef（资产引用）

用于定位任务关联的文件、位置、资产。

```typescript
type ArtifactRef = 
  | { kind: 'file_range'; path: string; lineStart: number; lineEnd: number }
  | { kind: 'outline_anchor'; sectionId: string }
  | { kind: 'asset'; assetId: string }
  | { kind: 'citation'; citeKey: string }
```

### 3.4 Thread（讨论串）

每个 Task 有一个 Thread，包含所有相关的 plan、patch、feedback。

```typescript
type Thread = {
  threadId: string
  taskId: string
  items: ThreadItem[]
}

type ThreadItem = 
  | { kind: 'plan'; planId: string; content: string; authorActorId: string; createdAt: string }
  | { kind: 'patch'; patchId: string; diff: string; authorActorId: string; createdAt: string }
  | { kind: 'feedback'; content: string; authorActorId: string; createdAt: string }
  | { kind: 'decision'; decision: 'accept' | 'reject'; targetPatchId: string; authorActorId: string; createdAt: string }
```

### 3.5 Artifact（资产）

论文相关的所有文件/资产统一抽象。

```typescript
type ArtifactType = 
  | 'tex'         // LaTeX 源文件
  | 'outline_md'  // OUTLINE.md
  | 'brief_md'    // BRIEF.md
  | 'style_md'    // STYLE.md
  | 'bib'         // BibTeX
  | 'figure'      // 图表
  | 'data'        // 数据
  | 'code'        // 代码
  | 'other'

type Artifact = {
  id: string
  type: ArtifactType
  path: string
  revision: string    // hash 或 mtime+size
  metadata?: Record<string, unknown>  // 图表/代码的 source/purpose/message
}
```

---

## 4. Billboard（协作中枢）

Billboard 是 V0 的核心组件，承担：

1. **统一入口**：所有 Adapter 只需 `appendEvent(TaskCreated)`
2. **统一出口**：UI 与 Agents 通过订阅 streams 得到最新任务状态与产物
3. **审计与可回放**：任何异常都可通过事件回放复盘
4. **高扩展性**：未来多 Agent、多 UI、多入口不会改变核心

### 4.1 组件组成

```
Billboard = EventStore + Projector + RxJS Streams
```

- **EventStore（持久化）**：追加写事件，支持回放
- **Projector（投影）**：从事件流派生读模型（TaskView、ThreadView）
- **Streams（实时）**：RxJS Observable 供 UI 和 Agent 订阅

### 4.2 API 设计

```typescript
interface Billboard {
  // 写入
  appendEvent(event: DomainEvent): StoredEvent
  
  // 读取（投影）
  getTask(taskId: string): TaskView | null
  queryTasks(filter: TaskFilter): TaskView[]
  getThread(taskId: string): ThreadView | null
  
  // 订阅
  events$: Observable<StoredEvent>
  taskViews$: Observable<TaskView[]>
}
```

---

## 5. Agent Runtime（Agent 运行时）

### 5.1 统一接口

所有 Agent 实现同一接口：

```typescript
interface Agent {
  readonly id: string
  readonly displayName: string
  
  // 是否能处理该任务，返回 0-1 的得分
  canHandle(task: TaskView, context: AgentContext): number
  
  // 执行任务，通过 yield 发出事件
  run(task: TaskView, context: AgentContext): AsyncGenerator<DomainEvent>
  
  // 用户回复后继续执行
  resume(task: TaskView, userReply: UserFeedbackEvent): AsyncGenerator<DomainEvent>
}
```

### 5.2 标准 Workflow 骨架

所有写作类 Agent 遵循统一骨架：

```
1. Claim        → emit TaskClaimed
2. Load Context → 读取 OUTLINE.md, 相关段落, BRIEF/STYLE
3. Drift Check  → 对比 baseRevisions vs 当前 revision
4. Plan         → emit AgentPlanPosted（可审阅的修改计划）
5. Generate     → emit PatchProposed（diff）
6. Self-Check   → 可选：LaTeX 编译、引用检查
7. Wait Review  → 状态变为 awaiting_review
8. Apply        → 用户 accept 后 emit PatchApplied
```

### 5.3 LLM Profile 策略

Agent 内部根据步骤选择不同模型：

- **fast**：路由/摘要/轻量改写
- **writer**：高质量 LaTeX 文本生成
- **reasoning**：plan、一致性检查、从代码提取方法描述

---

## 6. 目录结构

```
src/
├── index.ts                 # CLI 入口
│
├── domain/                  # 领域层（纯逻辑）
│   ├── actor.ts            # Actor 类型定义
│   ├── task.ts             # Task 类型定义
│   ├── artifact.ts         # Artifact 类型定义
│   ├── events.ts           # DomainEvent Zod schemas
│   ├── policies/           # 纯函数策略
│   │   └── scheduler.ts   # SchedulerPolicy
│   └── ports/              # 端口接口定义
│       ├── eventStore.ts  # EventStore 接口
│       ├── artifactStore.ts
│       └── llmClient.ts
│
├── application/             # 应用层（用例）
│   ├── usecases/
│   │   ├── postTask.ts
│   │   ├── claimTask.ts
│   │   ├── proposePatch.ts
│   │   ├── acceptPatch.ts
│   │   └── replayEvents.ts
│   └── services/
│       ├── contextBuilder.ts
│       └── driftDetector.ts
│
├── infrastructure/          # 基础设施层
│   ├── jsonlEventStore.ts
│   ├── fileWatcher.ts
│   ├── patchEngine.ts
│   └── logger.ts
│
├── agents/                  # Agent 层
│   ├── runtime.ts          # AgentRuntime
│   └── defaultAgent.ts     # DefaultCoAuthorAgent
│
├── interfaces/              # 接口层（适配器）
│   ├── cli/
│   │   ├── run.ts         # CLI 命令解析
│   │   └── io.ts          # IO 抽象
│   └── tui/
│       ├── main.tsx       # Ink TUI
│       └── run.ts
│
└── app/
    └── createApp.ts        # App 工厂
```

---

## 7. 依赖规则

遵循 **依赖倒置原则**：

```
Interfaces → Application → Domain ← Infrastructure
                              ↑
                           Agents
```

- **Domain** 不依赖任何外部模块，只定义接口（Ports）
- **Application** 依赖 Domain，通过 Ports 使用 Infrastructure
- **Infrastructure** 实现 Domain 定义的 Ports
- **Agents** 也只依赖 Domain 的 Ports
- **Interfaces** 依赖 Application，不直接调用 Domain/Infrastructure

---

## 8. 技术选型

| 层 | 技术 |
|----|------|
| Runtime | Node.js 22+ (ESM) |
| Language | TypeScript 5.x (Strict) |
| Schema Validation | Zod |
| Reactive Streams | RxJS 7.x |
| Event Store | JSONL（当前实现） |
| CLI | Yargs + Ink (可选) |
| DI | 手动注入 / tsyringe (可选) |
| Testing | Vitest |

---

## 9. 附录：与 Roadmap 愿景的映射

| Roadmap 愿景 | 架构实现 |
|--------------|----------|
| "User = Reviewer/PI" | Actor.kind = 'human' + capabilities |
| "LLM = Co-author/Postdoc" | Actor.kind = 'agent' |
| "Billboard" | EventStore + Projector + RxJS |
| "Task 不细分类" | Task.intent 是自由文本 |
| "Plan-first + Patch-first" | Agent workflow 标准骨架 |
| "用户手改感知" | DriftDetector + baseRevisions |
| "CLI 只是 Adapter" | Interfaces 层分离 |
| "V0 单 Agent" | 所有 Task 直接发送给默认 Agent |
| "V1 多 Agent" | OrchestratorAgent 可创建子任务 |
