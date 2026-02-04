# CoAuthor 领域模型规范

> 版本：V0.1  
> 最后更新：2026-02-03  
> 状态：规范文档（Normative）

本文档定义 CoAuthor 的领域模型：Event Schema、Entity 定义、Policy 规则。所有代码实现必须与本文档保持一致。

本规范已按 [ARCHITECTURE_DISCUSSION_2026-02-03.md](ARCHITECTURE_DISCUSSION_2026-02-03.md) 的方向重设进行更新：DomainEvent 仅表达 Task 生命周期与通用交互（UIP）；工具调用与其结果记录在独立的 AuditLog 中，不以 Plan/Patch 事件表达。

---

## V0/V1 特性边界

| 特性 | V0 状态 | V1 计划 |
|------|---------|---------|
| Task 生命周期事件 | ✅ 5 种事件（Created/Started/Completed/Failed/Canceled） | 可能新增 Claim/Subtask 等事件 |
| UIP 通用交互 | ✅ 完整实现 | - |
| Tool Use + AuditLog | ✅ 完整实现 | - |
| ConversationStore | ✅ 对话历史持久化 | - |
| 风险工具确认 | ✅ ToolExecutor 强制检查 | - |
| 任务分配 | 创建时直接指定 agentId | 多 Agent 路由（待定） |
| 子任务 | Schema 预留 parentTaskId | Orchestrator 完整实现 |
| InteractionPurpose.assign_subtask | 定义但不使用 | Orchestrator 使用 |
| ArtifactStore Port | TODO（直接使用 fs API） | 完整端口实现 |

---

## 1. Event Schema（事件 Schema）

### 1.1 设计原则

- **追加写**：事件只能追加，不能修改或删除
- **自描述**：每个事件包含足够信息用于审计和回放
- **Zod 校验**：所有事件使用 Zod schema 定义和校验
- **authorActorId**：每个事件必须记录谁触发的

### 1.2 StoredEvent（持久化事件）

```typescript
type StoredEvent = DomainEvent & {
  id: number          // 全局自增 ID
  streamId: string    // 通常是 taskId
  seq: number         // 流内序号
  createdAt: string   // ISO timestamp
}
```

### 1.3 DomainEvent（领域事件定义）

#### 1.3.1 任务生命周期事件

```typescript
// 任务创建
type TaskCreatedEvent = {
  type: 'TaskCreated'
  payload: {
    taskId: string
    title: string
    intent: string                    // 用户原始意图
    priority: 'foreground' | 'normal' | 'background'
    agentId: string                   // 指定处理的 Agent
    artifactRefs?: ArtifactRef[]      // 关联的文件/位置
    authorActorId: string             // 谁创建的（通常是 user）
  }
}

// 任务开始执行
type TaskStartedEvent = {
  type: 'TaskStarted'
  payload: {
    taskId: string
    agentId: string                   // 执行任务的 Agent
    authorActorId: string
  }
}

// 任务完成
type TaskCompletedEvent = {
  type: 'TaskCompleted'
  payload: {
    taskId: string
    summary?: string                  // 完成摘要
    authorActorId: string
  }
}

// 任务失败
type TaskFailedEvent = {
  type: 'TaskFailed'
  payload: {
    taskId: string
    reason: string
    authorActorId: string
  }
}

// 任务取消
type TaskCanceledEvent = {
  type: 'TaskCanceled'
  payload: {
    taskId: string
    reason?: string
    authorActorId: string
  }
}
```

> **V0.1 说明**：不再使用 Plan/Patch 事件表达协作流程；“等待用户确认/补充信息”等阶段统一用 UIP 表达。

#### 1.3.2 通用交互事件（UIP）

```typescript
type UserInteractionRequestedEvent = {
  type: 'UserInteractionRequested'
  payload: {
    interactionId: string
    taskId: string
    authorActorId: string

    kind: 'Select' | 'Confirm' | 'Input' | 'Composite'

    purpose:
      | 'choose_strategy'
      | 'request_info'
      | 'confirm_risky_action'
      | 'assign_subtask'
      | 'generic'

    display: {
      title: string
      description?: string
      content?: unknown
      contentKind?: 'PlainText' | 'Json' | 'Diff' | 'Table'
    }

    options?: Array<{
      id: string
      label: string
      style?: 'primary' | 'danger' | 'default'
      isDefault?: boolean
    }>

    validation?: {
      regex?: string
      required?: boolean
    }
  }
}

type UserInteractionRespondedEvent = {
  type: 'UserInteractionResponded'
  payload: {
    interactionId: string
    taskId: string
    authorActorId: string

    selectedOptionId?: string
    inputValue?: string
    comment?: string
  }
}
```

### 1.4 完整 DomainEvent Union（V0.1）

```typescript
type DomainEvent =
  // Task 生命周期
  | TaskCreatedEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCanceledEvent
  // UIP
  | UserInteractionRequestedEvent
  | UserInteractionRespondedEvent

type EventType = DomainEvent['type']
```

### 1.5 V0.1 事件集（7 种）

| 事件 | 说明 |
|------|------|
| `TaskCreated` | 用户发起任务请求（含 agentId 指定处理者） |
| `TaskStarted` | 任务开始执行 |
| `UserInteractionRequested` | 系统发起交互请求（统一协议） |
| `UserInteractionResponded` | 用户对交互请求做出回应 |
| `TaskCompleted` | 任务成功完成 |
| `TaskFailed` | 任务执行失败 |
| `TaskCanceled` | 任务被取消 |

---

## 2. Entity 定义

### 2.1 Actor

```typescript
import { z } from 'zod'

export const ActorKindSchema = z.enum(['human', 'agent'])

export const ActorCapabilitySchema = z.enum([
  'tool_read_file',
  'tool_edit_file',
  'tool_run_command',
  'run_latex_build',
  'read_assets',
  'create_task'
  // V1: 'claim_task' - Agent 主动认领任务
])

export const ActorSchema = z.object({
  id: z.string().min(1),
  kind: ActorKindSchema,
  displayName: z.string().min(1),
  capabilities: z.array(ActorCapabilitySchema),
  defaultAgentId: z.string().optional()
})

export type ActorKind = z.infer<typeof ActorKindSchema>
export type ActorCapability = z.infer<typeof ActorCapabilitySchema>
export type Actor = z.infer<typeof ActorSchema>
```

### 2.2 Task

```typescript
export const TaskStatusSchema = z.enum([
  'open',
  'in_progress',
  'awaiting_user',
  'done',
  'failed',
  'canceled'
])

export const TaskPrioritySchema = z.enum([
  'foreground',
  'normal',
  'background'
])

export const ArtifactRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file_range'),
    path: z.string().min(1),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive()
  }),
  z.object({
    kind: z.literal('outline_anchor'),
    sectionId: z.string().min(1)
  }),
  z.object({
    kind: z.literal('asset'),
    assetId: z.string().min(1)
  }),
  z.object({
    kind: z.literal('citation'),
    citeKey: z.string().min(1)
  })
])

export const TaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  intent: z.string(),
  createdBy: z.string().min(1),           // ActorId
  priority: TaskPrioritySchema,
  status: TaskStatusSchema,
  artifactRefs: z.array(ArtifactRefSchema).optional(),
  baseRevisions: z.record(z.string()).optional(),
  createdAt: z.string().min(1),
  // V1: 子任务支持
  parentTaskId: z.string().optional()
})

export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type TaskPriority = z.infer<typeof TaskPrioritySchema>
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>
export type Task = z.infer<typeof TaskSchema>
```

### 2.3 Artifact

```typescript
export const ArtifactTypeSchema = z.enum([
  'tex',
  'outline_md',
  'brief_md',
  'style_md',
  'bib',
  'figure',
  'data',
  'code',
  'other'
])

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  type: ArtifactTypeSchema,
  path: z.string().min(1),
  revision: z.string().min(1),
  metadata: z.record(z.unknown()).optional()
})

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>
export type Artifact = z.infer<typeof ArtifactSchema>
```

### 2.4 说明：Plan/Patch（已废弃）

V0.1 不再将 plan/patch 作为领域对象与领域事件的一部分。若需要兼容历史事件日志或旧实现的对照，请参考文末 `附录 A（Deprecated）`。

---

## 3. Projection 定义

Projection 是从事件流派生的读模型，用于快速查询。

### 3.1 TaskView

```typescript
/**
 * TaskView - Read model for fast task queries.
 * Projected from DomainEvents via reducer.
 */
export type TaskView = {
  taskId: string
  title: string
  intent: string
  createdBy: string
  agentId: string                 // V0: 创建时直接指定的处理 Agent
  priority: TaskPriority
  status: TaskStatus
  artifactRefs?: ArtifactRef[]
  baseRevisions?: Record<string, string>  // 创建时的文件版本快照
  
  // UIP 交互状态
  pendingInteractionId?: string   // 当前等待响应的交互 ID
  lastInteractionId?: string      // 最后一次交互的 ID
  
  // V1 预留：子任务支持
  parentTaskId?: string
  childTaskIds?: string[]
  
  createdAt: string
  updatedAt: string               // 最后事件时间
}
```

### 3.2 Projection Reducer 规范

```typescript
export type ProjectionReducer<TState> = (
  state: TState,
  event: StoredEvent
) => TState
```

每个 Projection 必须：
1. 提供 `defaultState`
2. 提供纯函数 `reducer`
3. 支持幂等（同一事件多次 apply 结果相同）

---

## 4. Policy 规则

Policy 是纯函数，用于决策逻辑。不依赖外部状态。

### 4.1 V0 任务分发模型

V0 采用 **单 Agent 直连模型**，无需路由：

```
用户 → Billboard (TaskCreated) → 默认 Agent 自动认领 → 执行 workflow
```

这类似于 chat 模式，但任务经过 Billboard 形成可审计的 Task 历史。

**V1 扩展：Orchestrator 子任务模型（仅交互层）**

当 Orchestrator 需要把工作拆成多个子任务并选择执行者时，V0.1 只要求交互统一走 UIP：
- `UserInteractionRequested(purpose=assign_subtask, kind=Select, options=[agentA, agentB, ...])`
- `UserInteractionResponded(selectedOptionId=agentB)`

子任务是否需要额外的领域事件属于后续设计（可选）；本规范不在 DomainEvent 中预置 `SubtaskCreated/SubtaskCompleted` 事件类型。

### 4.2 SchedulerPolicy

```typescript
export type SchedulerPolicy = (
  tasks: TaskView[]
) => TaskView[]  // 返回排序后的任务列表

// V0 默认实现：按优先级和创建时间排序
export const defaultSchedulerPolicy: SchedulerPolicy = (tasks) => {
  const priorityOrder = { foreground: 0, normal: 1, background: 2 }
  
  return [...tasks]
    .filter(t => t.status === 'open' || t.status === 'in_progress')
    .sort((a, b) => {
      // 先按优先级
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (pDiff !== 0) return pDiff
      // 再按创建时间
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
}
```

### 4.3 RebasePolicy

```typescript
export type DriftInfo = {
  path: string
  expectedRevision: string
  actualRevision: string
}

export type RebaseDecision = 
  | { action: 'auto_rebase'; reason: string }
  | { action: 'block'; reason: string; questions: string[] }
  | { action: 'continue'; reason: string }

export type RebasePolicy = (
  task: TaskView,
  drifts: DriftInfo[]
) => RebaseDecision

// V0 默认实现
export const defaultRebasePolicy: RebasePolicy = (task, drifts) => {
  if (drifts.length === 0) {
    return { action: 'continue', reason: 'No drift detected' }
  }
  
  // V0：自动 rebase，但记录 drift
  return {
    action: 'auto_rebase',
    reason: `Detected ${drifts.length} file(s) changed since task created`
  }
}
```

---

## 5. Port 接口定义

### 5.1 EventStore

```typescript
export interface EventStore {
  // 初始化 schema（创建表等）
  ensureSchema(): void
  
  // 追加事件
  append(streamId: string, events: DomainEvent[]): StoredEvent[]
  
  // 读取所有事件（从指定 ID 之后）
  readAll(fromIdExclusive?: number): StoredEvent[]
  
  // 读取特定流的事件
  readStream(streamId: string, fromSeqInclusive?: number): StoredEvent[]
  
  // 按 ID 读取单个事件
  readById(id: number): StoredEvent | null
  
  // Projection 状态管理
  getProjection<TState>(name: string, defaultState: TState): {
    cursorEventId: number
    state: TState
  }
  saveProjection<TState>(name: string, cursorEventId: number, state: TState): void
}
```

### 5.2 ConversationStore

用于持久化 Agent 与 LLM 的对话历史，支持跨 UIP 暂停、程序重启的状态恢复。

```typescript
import type { LLMMessage } from './llmClient.js'

/**
 * 对话条目 - 消息 + 任务上下文
 */
export type ConversationEntry = {
  taskId: string       // 所属任务
  index: number        // 任务内顺序索引
  message: LLMMessage  // LLM 消息
}

/**
 * 持久化的对话条目（含元数据）
 */
export type StoredConversationEntry = ConversationEntry & {
  id: number           // 全局自增 ID
  createdAt: string    // ISO timestamp
}

/**
 * ConversationStore 端口接口
 *
 * 职责分离：
 * - EventStore: User ↔ Agent 协作决策
 * - AuditLog: Agent ↔ Tools/Files 执行审计
 * - ConversationStore: Agent ↔ LLM 对话上下文
 */
export interface ConversationStore {
  // 初始化 schema
  ensureSchema(): void
  
  // 追加消息到任务对话历史
  append(taskId: string, message: LLMMessage): StoredConversationEntry
  
  // 获取任务的所有消息（按顺序）
  getMessages(taskId: string): LLMMessage[]
  
  // 截断对话历史，只保留最后 N 条
  truncate(taskId: string, keepLastN: number): void
  
  // 清除任务的所有对话历史
  clear(taskId: string): void
  
  // 读取所有条目（调试/测试用）
  readAll(fromIdExclusive?: number): StoredConversationEntry[]
}
```

### 5.3 ArtifactStore

```typescript
export interface ArtifactStore {
  // 读取文件内容
  readFile(path: string): Promise<string>
  
  // 读取文件指定行范围
  readFileRange(path: string, lineStart: number, lineEnd: number): Promise<string>
  
  // 获取文件版本（hash）
  getRevision(path: string): Promise<string>
  
  // 列出目录
  listDir(path: string): Promise<string[]>
  
  // 写入文件
  writeFile(path: string, content: string): Promise<void>
}
```

### 5.3 LLMClient

```typescript
import type { ToolDefinition, ToolCallRequest } from './tool.js'

export type LLMProfile = 'fast' | 'writer' | 'reasoning'

export type LLMMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: ToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; content: string }

// ============================================================================
// LLM Response Types
// ============================================================================

export type LLMStopReason = 'end_turn' | 'tool_use' | 'max_tokens'

export type LLMResponse = {
  content?: string
  toolCalls?: ToolCallRequest[]
  stopReason: LLMStopReason
}

// ============================================================================
// LLM Options
// ============================================================================

export type LLMCompleteOptions = {
  profile: LLMProfile
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  maxTokens?: number
}

export type LLMStreamOptions = {
  profile: LLMProfile
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  maxTokens?: number
}

// ============================================================================
// LLM Stream Chunk Types
// ============================================================================

export type LLMStreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string }
  | { type: 'tool_call_delta'; toolCallId: string; argumentsDelta: string }
  | { type: 'tool_call_end'; toolCallId: string }
  | { type: 'done'; stopReason: LLMStopReason }

// ============================================================================
// LLM Client Interface
// ============================================================================

export interface LLMClient {
  /**
   * Complete a conversation (non-streaming).
   * Returns structured response with content and/or tool calls.
   */
  complete(opts: LLMCompleteOptions): Promise<LLMResponse>

  /**
   * Stream a conversation.
   * Yields chunks for text and tool calls.
   */
  stream(opts: LLMStreamOptions): AsyncGenerator<LLMStreamChunk>
}
```

---

## 6. 命名约定

### 6.1 ID 命名

| 类型 | 格式 | 示例 |
|------|------|------|
| taskId | nanoid(21) | `V1StGXR8_Z5jdHi6B-myT` |
| interactionId | `ui_` + nanoid(12) | `ui_abc123def456` |
| toolCallId | `tool_` + nanoid(12) | `tool_xyz789uvw012` |
| actorId (user) | `user_` + identifier | `user_jerry` |
| actorId (agent) | `agent_` + name | `agent_coauthor_default` |

### 6.2 事件流 ID

| 流类型 | streamId 格式 |
|--------|---------------|
| 任务流 | `task_{taskId}` 或直接用 `taskId` |
| 全局流 | 不分流，所有事件按 `id` 排序 |

### 6.3 文件路径

- 使用相对于 `baseDir` 的路径
- 使用 POSIX 风格（`/` 分隔符）
- 示例：`chapters/01_introduction.tex`

---

## 7. 验证规则

### 7.1 事件验证

所有事件写入前必须通过 Zod schema 验证：

```typescript
export function validateEvent(event: unknown): DomainEvent {
  return DomainEventSchema.parse(event)
}
```

### 7.2 业务规则验证

| 规则 | 说明 |
|------|------|
| 任务状态转换 | 只能按状态机转换（见下图） |
| 工具高风险动作 | 写文件/执行命令等必须先走 UIP `confirm_risky_action` |
| Actor 权限 | 只有具备对应 tool capability 才能执行对应 Tool Use |

### 7.3 任务状态机 (V0)

```
(TaskCreated) open ────────────────────────────────────→ canceled
  │
  ├─ TaskStarted ──→ in_progress
  │                      │
  │                      ├─ UserInteractionRequested ──→ awaiting_user
  │                      │                                 │
  │                      │                                 └─ UserInteractionResponded ──→ in_progress
  │                      │
  │                      ├─ TaskCompleted ──→ done
  │                      │
  │                      └─ TaskFailed ──→ failed
  │
  └─ TaskFailed ──→ failed
```

> MVP：不引入 `TaskClaimed` 事件与 `claimed` 状态；`TaskStarted` 作为唯一“开始运行”标记。

---

## 8. 与现有代码的兼容映射

| 现有代码 | 新规范 |
|----------|--------|
| `domain.ts` | 拆分为 `domain/events.ts` + `domain/task.ts` + `domain/actor.ts` |
| `TaskCreated.payload.taskId` | 保留，增加 `authorActorId` |
| `Patch*`/`AgentPlanPosted` 等旧事件 | 不再属于 DomainEvent（V0.1）；迁移为 UIP + Tool Audit 表达（见附录 A） |

---

## 附录 A（Deprecated）：旧 Plan/Patch 事件与迁移映射

本附录仅用于阅读历史事件日志或迁移旧实现。自 V0.1 起，不应再新增使用这些事件或将其作为协作协议的一部分。

### A.1 旧事件清单（历史兼容）

- `AgentPlanPosted`
- `PatchProposed` / `PatchAccepted` / `PatchRejected` / `PatchApplied` / `PatchConflicted`
- `UserFeedbackPosted`

### A.2 迁移映射（推荐表达）

- 计划/方案呈现：使用 `UserInteractionRequested(display.contentKind=PlainText|Json, purpose=choose_strategy)`。
- diff/变更预览：使用 `UserInteractionRequested(display.contentKind=Diff, purpose=confirm_risky_action)`。
- 文件修改与命令执行：通过 Tool Use 执行，并在 AuditLog 中记录 `ToolCallRequested/ToolCallCompleted`；不要用 DomainEvent 记录具体 diff 或写入细节。
- 冲突/失败：由工具执行结果（AuditLog 的 isError=true 等）与后续 UIP 交互引导用户决策；必要时以 `TaskFailed` 终止任务。
