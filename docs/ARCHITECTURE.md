# CoAuthor 架构设计文档

> 版本：V0.1  
> 最后更新：2026-02-03  
> 状态：规范文档（Normative）

本文档定义 CoAuthor 的架构设计原则、分层结构、核心概念。是系统设计的"宪法"，所有实现必须遵守。

本规范已按 [ARCHITECTURE_DISCUSSION_2026-02-03.md](ARCHITECTURE_DISCUSSION_2026-02-03.md) 的方向重设进行更新：不再以 Plan/Patch 事件作为协作协议；Task 事件只描述协作与决策，具体文件修改与命令执行走独立的工具审计链路。

---

## 1. 设计原则（6 条守则）

### 1.1 所有输入都变成 Task，所有输出都进入事件流

无论用户通过 CLI chat、斜杠命令、未来的 TODO comment、还是 Overleaf 插件发起请求，都统一封装为 **Task**。

所有“协作与决策”产出（任务生命周期、交互请求/回应、关键选择）都作为 **DomainEvent** 写入事件流，形成可回放的协作历史。

文件修改、命令执行等“执行细节”不进入 DomainEvent，而是通过 Tool Use 完成，并写入独立的 **AuditLog**（工具审计日志）。
Agent 与 LLM 的对话历史（执行上下文）存储在独立的 **ConversationStore**，支持跨 UIP 暂停、程序重启的状态恢复。

三层存储职责分离：
- **EventStore**：User ↔ Agent 协作决策
- **AuditLog**：Agent ↔ Tools/Files 执行审计
- **ConversationStore**：Agent ↔ LLM 对话上下文
### 1.2 UIP：通用交互协议优先

用户交互不为某个业务类型（如 plan/patch 这类旧概念或其他）量身定制事件。系统用统一的 UIP 表达两件事：
1. 系统向用户提出交互请求（`UserInteractionRequested`）
2. 用户对该请求做出响应（`UserInteractionResponded`）

### 1.3 用户随手改文件不会被覆盖

系统必须避免“盲写覆盖”。对高风险/不可逆的 Tool Use（写文件、批量替换、执行会修改环境的命令等）必须先取得明确的 UIP 确认（`purpose=confirm_risky_action`），并在工具审计日志中完整记录请求与结果。

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
- 能否执行某些 Tool Use（例如写文件、执行命令）

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
│  │  - CreateTask: 创建任务（TaskCreated）                   │
│  │  - RunTask: 运行 Agent（TaskStarted → ... → Completed）  │
│  │  - CancelTask: 取消任务                                  │
│  │  - RequestUserInteraction: 发起 UIP 交互请求             │
│  │  - RespondUserInteraction: 提交 UIP 交互响应             │
│  │  - ReplayEvents: 事件回放                                │
│  │                                                          │
│  │  Services:                                               │
│  │  - ContextBuilder: 构建 Agent 上下文                     │
│  │  - Scheduler: 任务调度策略 (V1)                          │
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
│  │  - Artifact: 资产（tex / outline / figure / code）       │
│  │                                                          │
│  │  Events (Zod Schemas):                                   │
│  │  - DomainEvent: 所有事件的 discriminated union           │
│  │  - 见 DOMAIN.md 完整定义                                 │
│  │                                                          │
│  │  Ports (Interfaces):                                     │
│  │  - EventStore: 事件存储接口                              │
│  │  - ConversationStore: 对话历史存储接口                   │
│  │  - AuditLog: 工具审计日志接口                            │
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
│  │                                                          │   ││  │  ConversationStore Implementations:                      │
│  │  - JsonlConversationStore: 对话历史 JSONL 存储           │
│  │                                                          ││  │  Other Adapters:                                         │
│  │  - LLMProviders: Claude/OpenAI/Local 适配               │
│  │  - ToolRegistry/ToolExecutor: 工具注册与执行             │
│  │  - AuditLogWriter: 工具审计日志追加写                    │
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
  | 'tool_read_file'   // 可读取文件/资产
  | 'tool_edit_file'   // 可修改文件（高风险）
  | 'tool_run_command' // 可执行命令（高风险）
  | 'run_latex_build'  // 可运行 LaTeX 编译
  | 'read_assets'      // 可读取资产
  | 'create_task'      // 可创建任务
  // V1: | 'claim_task' // 可认领任务（Agent 特有）
```

### 3.2 Task（任务）

Task 是统一的任务载体。V0 不做强类型细分，不做路由——所有任务直接发送给默认 Agent。

```typescript
type TaskStatus = 
  | 'open'            // 待处理
  | 'in_progress'     // 执行中
  | 'awaiting_user'   // 等待用户交互（由 UIP 驱动）
  | 'done'            // 完成
  | 'failed'          // 失败（终态）
  | 'canceled'        // 已取消

type TaskPriority = 'foreground' | 'normal' | 'background'

type Task = {
  taskId: string
  title: string            // 任务标题（展示用，必填）
  createdBy: string        // ActorId
  agentId: string          // V0: 创建时直接指定处理 Agent
  priority: TaskPriority
  status: TaskStatus
  intent: string           // 用户意图（自由文本）
  artifactRefs?: ArtifactRef[]  // 关联的资产/位置
  baseRevisions?: Record<string, string>  // 创建时的文件版本快照
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

### 3.4 Artifact（资产）

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

1. **统一入口**：所有 Adapter 只需调用 Application Services（最终追加 DomainEvent 到 EventStore）
2. **统一出口**：UI 与 Agents 可订阅 `EventStore.events$` 获取事件流；任务读模型由投影派生
3. **审计与可回放**：任何异常都可通过事件回放复盘
4. **高扩展性**：未来多 Agent、多 UI、多入口不会改变核心

### 4.1 组件组成

```
Billboard（概念）= EventStore + Projector + RxJS events$
```

- **EventStore（持久化）**：追加写事件，支持回放
- **Projector（投影）**：从事件流派生读模型（TaskView）
- **events$（实时）**：EventStore 暴露 RxJS Observable，供 UI 和 Agent 订阅

### 4.2 API 设计

```typescript
// V0.1 当前实现没有单独的 Billboard 抽象，组合根（createApp）直接注入以下能力：
interface EventStore {
  append(streamId: string, events: DomainEvent[]): StoredEvent[]
  readAll(fromIdExclusive?: number): StoredEvent[]
  readStream(streamId: string, fromSeqInclusive?: number): StoredEvent[]
  events$: Observable<StoredEvent>
}

interface TaskService {
  createTask(...): { taskId: string }
  listTasks(): { tasks: TaskView[] }
  getTask(taskId: string): TaskView | null
}

interface EventService {
  replayEvents(streamId?: string): StoredEvent[]
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
  
  // 执行任务，通过 AgentOutput 通知 runtime
  run(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput>
}

// Agent 输出类型
type AgentOutput = 
  | { kind: 'text'; content: string }
  | { kind: 'tool_call'; call: ToolCallRequest }
  | { kind: 'interaction'; request: InteractionRequest & { interactionId: string } }
  | { kind: 'done'; summary?: string }
  | { kind: 'failed'; reason: string }

// Agent 上下文
type AgentContext = {
  llm: LLMClient
  tools: ToolRegistry
  baseDir: string
  conversationHistory: readonly LLMMessage[]  // 从 ConversationStore 加载
  pendingInteractionResponse?: UserInteractionRespondedPayload
  toolResults: Map<string, ToolResult>
  confirmedInteractionId?: string
  persistMessage: (message: LLMMessage) => void  // 持久化新消息
}
```

### 5.2 标准 Workflow 骨架

所有写作类 Agent 遵循统一骨架：

```
1. Start        → emit TaskStarted
2. LOOP:
     - agent 推进任务（调用工具：readFile, editFile, listFiles, runCommand）
     - 工具调用记录写入 AuditLog（不进 DomainEvent）
     - 若缺信息/需决策：UserInteractionRequested(purpose=request_info|choose_strategy) → UserInteractionResponded
     - 若即将执行高风险工具动作：UserInteractionRequested(purpose=confirm_risky_action)
3. Done/Fail/Cancel → emit TaskCompleted | TaskFailed | TaskCanceled
```

### 5.3 LLM Profile 策略

Agent 内部根据步骤选择不同模型：

- **fast**：路由/摘要/轻量改写
- **writer**：高质量 LaTeX 文本生成
- **reasoning**：策略选择、一致性检查、从代码提取方法描述

---

## 6. 目录结构

```
src/
├── index.ts                 # CLI 入口
│
├── domain/                  # 领域层（纯逻辑）
│   ├── actor.ts            # Actor 类型定义
│   ├── task.ts             # Task/TaskStatus 类型定义
│   ├── artifact.ts         # Artifact 类型定义
│   ├── events.ts           # DomainEvent Zod schemas (7 事件类型)
│   └── ports/              # 端口接口定义
│       ├── eventStore.ts   # EventStore 接口
│       ├── conversationStore.ts  # ConversationStore 接口
│       ├── artifactStore.ts # ArtifactStore 接口（V0 可暂不使用）
│       ├── llmClient.ts    # LLMClient 接口
│       ├── tool.ts         # Tool/ToolRegistry/ToolExecutor 接口
│       └── auditLog.ts     # AuditLog 接口
│
├── application/             # 应用层（用例/服务）
│   ├── taskService.ts      # Task CRUD + 投影
│   ├── eventService.ts     # 事件回放
│   ├── interactionService.ts # UIP 请求/响应
│   ├── contextBuilder.ts   # Agent 上下文构建
│   ├── projector.ts        # 投影运行器
│   └── revision.ts         # 内容 revision 计算
│
├── infra/                   # 基础设施层
│   ├── jsonlEventStore.ts  # JSONL EventStore 实现
│   ├── jsonlConversationStore.ts  # JSONL ConversationStore 实现
│   ├── jsonlAuditLog.ts    # JSONL AuditLog 实现
│   ├── toolRegistry.ts     # DefaultToolRegistry 实现
│   ├── toolExecutor.ts     # DefaultToolExecutor 实现
│   ├── fakeLLMClient.ts    # 测试用 LLM 实现
│   ├── openaiLLMClient.ts  # OpenAI LLM 实现
│   └── tools/              # 内置工具
│       ├── readFile.ts
│       ├── editFile.ts
│       ├── listFiles.ts
│       └── runCommand.ts
│
├── agents/                  # Agent 层
│   ├── agent.ts            # Agent 接口 + AgentOutput/AgentContext
│   ├── runtime.ts          # AgentRuntime（UIP+工具循环）
│   └── defaultAgent.ts     # DefaultCoAuthorAgent
│
├── cli/                     # CLI 接口层
│   ├── run.ts              # CLI 命令解析
│   └── io.ts               # IO 抽象
│
├── tui/                     # TUI 接口层
│   ├── main.tsx            # Ink TUI
│   └── run.ts
│
├── config/
│   └── appConfig.ts        # 配置加载
│
├── patch/
│   └── applyUnifiedPatch.ts # 统一差分应用工具
│
└── app/
    └── createApp.ts        # App 工厂（依赖注入）
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
| "UIP（统一交互）" | UserInteractionRequested/Responded + UI 统一渲染 |
| "工具审计解耦" | ToolRegistry/ToolExecutor + AuditLog（执行细节不进 DomainEvent） |
| "CLI 只是 Adapter" | Interfaces 层分离 |
| "V0 单 Agent" | 所有 Task 直接发送给默认 Agent |
| "V1 多 Agent" | OrchestratorAgent 可创建子任务 |
