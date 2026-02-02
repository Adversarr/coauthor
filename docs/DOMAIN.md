# CoAuthor 领域模型规范

> 版本：V0  
> 最后更新：2026-02-02  
> 状态：规范文档（Normative）

本文档定义 CoAuthor 的领域模型：Event Schema、Entity 定义、Policy 规则。所有代码实现必须与本文档保持一致。

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
    artifactRefs?: ArtifactRef[]      // 关联的文件/位置
    authorActorId: string             // 谁创建的（通常是 user）
  }
}

// 任务路由（分配给某个 Agent）
type TaskRoutedEvent = {
  type: 'TaskRouted'
  payload: {
    taskId: string
    assignedTo: string                // AgentId
    routedBy: string                  // 路由策略或 ActorId
    authorActorId: string
  }
}

// 任务被 Agent 认领
type TaskClaimedEvent = {
  type: 'TaskClaimed'
  payload: {
    taskId: string
    claimedBy: string                 // AgentId
    baseRevisions: Record<string, string>  // 快照相关文件版本
    authorActorId: string
  }
}

// 任务开始执行
type TaskStartedEvent = {
  type: 'TaskStarted'
  payload: {
    taskId: string
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

// 任务被阻塞（需要用户补充信息）
type TaskBlockedEvent = {
  type: 'TaskBlocked'
  payload: {
    taskId: string
    reason: string
    questions?: string[]              // 需要用户回答的问题
    authorActorId: string
  }
}
```

#### 1.3.2 计划与补丁事件

```typescript
// Agent 发布修改计划
type AgentPlanPostedEvent = {
  type: 'AgentPlanPosted'
  payload: {
    taskId: string
    planId: string
    plan: {
      goal: string                    // 修改目标
      issues?: string[]               // 识别到的问题
      strategy: string                // 采取的策略
      scope: string                   // 改动范围描述
      risks?: string[]                // 风险提示
      questions?: string[]            // 阻塞性问题（如需）
    }
    authorActorId: string
  }
}

// 补丁提议
type PatchProposedEvent = {
  type: 'PatchProposed'
  payload: {
    taskId: string
    proposalId: string
    targetPath: string                // 目标文件路径
    patchText: string                 // Unified diff 格式
    baseRevision: string              // 基于哪个版本
    authorActorId: string
  }
}

// 补丁被接受
type PatchAcceptedEvent = {
  type: 'PatchAccepted'
  payload: {
    taskId: string
    proposalId: string
    authorActorId: string             // 谁接受的（通常是 user）
  }
}

// 补丁被拒绝
type PatchRejectedEvent = {
  type: 'PatchRejected'
  payload: {
    taskId: string
    proposalId: string
    reason?: string
    authorActorId: string
  }
}

// 补丁已应用到文件
type PatchAppliedEvent = {
  type: 'PatchApplied'
  payload: {
    taskId: string
    proposalId: string
    targetPath: string
    patchText: string
    appliedAt: string
    newRevision: string               // 应用后的文件版本
    authorActorId: string
  }
}
```

#### 1.3.3 反馈与交互事件

```typescript
// 用户反馈
type UserFeedbackPostedEvent = {
  type: 'UserFeedbackPosted'
  payload: {
    taskId: string
    feedback: string
    targetProposalId?: string         // 针对哪个 patch 的反馈
    authorActorId: string
  }
}

// Thread 打开（用户进入某个任务的讨论）
type ThreadOpenedEvent = {
  type: 'ThreadOpened'
  payload: {
    taskId: string
    authorActorId: string
  }
}
```

#### 1.3.4 资产与文件事件

```typescript
// 资产/文件变更（由 FileWatcher 产生）
type ArtifactChangedEvent = {
  type: 'ArtifactChanged'
  payload: {
    path: string
    oldRevision?: string
    newRevision: string
    changeKind: 'created' | 'modified' | 'deleted'
    authorActorId: string             // 'system' 或检测到的 actor
  }
}

// 任务需要 Rebase（检测到 drift）
type TaskNeedsRebaseEvent = {
  type: 'TaskNeedsRebase'
  payload: {
    taskId: string
    affectedPaths: string[]
    reason: string
    authorActorId: string
  }
}

// 任务已 Rebase
type TaskRebasedEvent = {
  type: 'TaskRebased'
  payload: {
    taskId: string
    oldBaseRevisions: Record<string, string>
    newBaseRevisions: Record<string, string>
    authorActorId: string
  }
}
```

### 1.4 完整 DomainEvent Union

```typescript
type DomainEvent =
  // 任务生命周期
  | TaskCreatedEvent
  | TaskRoutedEvent
  | TaskClaimedEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCanceledEvent
  | TaskBlockedEvent
  // 计划与补丁
  | AgentPlanPostedEvent
  | PatchProposedEvent
  | PatchAcceptedEvent
  | PatchRejectedEvent
  | PatchAppliedEvent
  // 反馈与交互
  | UserFeedbackPostedEvent
  | ThreadOpenedEvent
  // 资产与文件
  | ArtifactChangedEvent
  | TaskNeedsRebaseEvent
  | TaskRebasedEvent

type EventType = DomainEvent['type']
```

### 1.5 V0 最小事件集

V0 阶段需要实现的最小事件集：

| 事件 | 必需 | 说明 |
|------|------|------|
| TaskCreated | ✅ | 任务创建 |
| TaskClaimed | ✅ | Agent 认领 |
| AgentPlanPosted | ✅ | 修改计划 |
| PatchProposed | ✅ | 补丁提议 |
| PatchAccepted | ✅ | 接受补丁 |
| PatchApplied | ✅ | 应用补丁 |
| UserFeedbackPosted | ✅ | 用户反馈 |
| ThreadOpened | ⚪ | 可选，兼容现有 |
| ArtifactChanged | ⚪ | M2 实现 |
| TaskNeedsRebase | ⚪ | M2 实现 |

---

## 2. Entity 定义

### 2.1 Actor

```typescript
import { z } from 'zod'

export const ActorKindSchema = z.enum(['human', 'agent'])

export const ActorCapabilitySchema = z.enum([
  'apply_patch',
  'run_latex_build',
  'read_assets',
  'create_task',
  'claim_task'
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
  'claimed',
  'in_progress',
  'awaiting_review',
  'done',
  'blocked',
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
  assignedTo: z.string().optional(),       // ActorId
  priority: TaskPrioritySchema,
  status: TaskStatusSchema,
  artifactRefs: z.array(ArtifactRefSchema).optional(),
  baseRevisions: z.record(z.string()).optional(),
  threadId: z.string().min(1),
  createdAt: z.string().min(1)
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

### 2.4 Plan

```typescript
export const PlanSchema = z.object({
  planId: z.string().min(1),
  taskId: z.string().min(1),
  goal: z.string().min(1),
  issues: z.array(z.string()).optional(),
  strategy: z.string().min(1),
  scope: z.string().min(1),
  risks: z.array(z.string()).optional(),
  questions: z.array(z.string()).optional(),
  authorActorId: z.string().min(1),
  createdAt: z.string().min(1)
})

export type Plan = z.infer<typeof PlanSchema>
```

### 2.5 PatchProposal

```typescript
export const PatchProposalSchema = z.object({
  proposalId: z.string().min(1),
  taskId: z.string().min(1),
  targetPath: z.string().min(1),
  patchText: z.string().min(1),
  baseRevision: z.string().min(1),
  status: z.enum(['pending', 'accepted', 'rejected', 'applied']),
  authorActorId: z.string().min(1),
  createdAt: z.string().min(1)
})

export type PatchProposal = z.infer<typeof PatchProposalSchema>
```

---

## 3. Projection 定义

Projection 是从事件流派生的读模型，用于快速查询。

### 3.1 TaskView

```typescript
export type TaskView = {
  taskId: string
  title: string
  intent: string
  createdBy: string
  assignedTo?: string
  priority: TaskPriority
  status: TaskStatus
  artifactRefs?: ArtifactRef[]
  baseRevisions?: Record<string, string>
  
  // 派生字段
  currentPlanId?: string
  pendingProposals: string[]
  appliedProposals: string[]
  
  createdAt: string
  updatedAt: string
}
```

### 3.2 ThreadView

```typescript
export type ThreadItem = {
  id: string
  kind: 'plan' | 'patch' | 'feedback' | 'decision'
  content: string
  authorActorId: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export type ThreadView = {
  threadId: string
  taskId: string
  items: ThreadItem[]
}
```

### 3.3 Projection Reducer 规范

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

### 4.1 RouterPolicy

```typescript
export type RouterPolicy = (
  task: TaskView,
  availableAgents: Actor[]
) => string | null  // 返回 AgentId 或 null（无法路由）

// V0 默认实现
export const defaultRouterPolicy: RouterPolicy = (task, agents) => {
  // 如果已指定 assignedTo，直接返回
  if (task.assignedTo) return task.assignedTo
  
  // 否则返回第一个可用的 agent
  const defaultAgent = agents.find(a => a.kind === 'agent')
  return defaultAgent?.id ?? null
}
```

### 4.2 SchedulerPolicy

```typescript
export type SchedulerPolicy = (
  tasks: TaskView[]
) => TaskView[]  // 返回排序后的任务列表

// V0 默认实现
export const defaultSchedulerPolicy: SchedulerPolicy = (tasks) => {
  const priorityOrder = { foreground: 0, normal: 1, background: 2 }
  
  return [...tasks]
    .filter(t => t.status === 'open' || t.status === 'claimed')
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

### 5.2 ArtifactStore

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
  
  // 应用 patch
  applyPatch(path: string, patchText: string): Promise<{ newRevision: string }>
}
```

### 5.3 LLMClient

```typescript
export type LLMProfile = 'fast' | 'writer' | 'reasoning'

export type LLMMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMClient {
  // 单次补全
  complete(opts: {
    profile: LLMProfile
    messages: LLMMessage[]
    maxTokens?: number
  }): Promise<string>
  
  // 流式补全
  stream(opts: {
    profile: LLMProfile
    messages: LLMMessage[]
    maxTokens?: number
  }): AsyncGenerator<string>
}
```

---

## 6. 命名约定

### 6.1 ID 命名

| 类型 | 格式 | 示例 |
|------|------|------|
| taskId | nanoid(21) | `V1StGXR8_Z5jdHi6B-myT` |
| planId | `plan_` + nanoid(12) | `plan_abc123def456` |
| proposalId | `patch_` + nanoid(12) | `patch_xyz789uvw012` |
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
| Patch 应用 | baseRevision 必须匹配当前文件版本 |
| Actor 权限 | 只有 'apply_patch' capability 才能应用 patch |

### 7.3 任务状态机

```
open ──────────────────────────────────────────────────→ canceled
  │
  ├─ TaskClaimed ──→ claimed
  │                    │
  │                    ├─ TaskStarted ──→ in_progress
  │                    │                      │
  │                    │                      ├─ PatchProposed ──→ awaiting_review
  │                    │                      │                         │
  │                    │                      │                         ├─ PatchAccepted + Applied ──→ done
  │                    │                      │                         │
  │                    │                      │                         ├─ PatchRejected ──→ in_progress
  │                    │                      │                         │
  │                    │                      │                         └─ UserFeedback ──→ in_progress
  │                    │                      │
  │                    │                      └─ TaskBlocked ──→ blocked
  │                    │                                            │
  │                    │                                            └─ UserFeedback ──→ in_progress
  │                    │
  │                    └─ TaskFailed ──→ (terminal)
  │
  └─ TaskFailed ──→ (terminal)
```

---

## 8. 与现有代码的兼容映射

| 现有代码 | 新规范 |
|----------|--------|
| `domain.ts` | 拆分为 `domain/events.ts` + `domain/task.ts` + `domain/actor.ts` |
| `TaskCreated.payload.taskId` | 保留，增加 `authorActorId` |
| `ThreadOpened` | 保留，增加 `authorActorId` |
| `PatchProposed` | 保留，增加 `authorActorId` + `baseRevision` |
| `PatchApplied` | 保留，增加 `authorActorId` + `newRevision` |
