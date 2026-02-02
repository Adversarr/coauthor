# 架构审计与技术债务报告

> 本文档记录 M0 架构审计结果，包括技术债务和 V1 准备工作。  
> 最后更新：2026-02-02

---

## 📊 M0 状态总结

| 指标 | 状态 |
|------|------|
| **测试通过率** | 7/7 (100%) ✅ |
| **TypeScript 编译** | 0 错误 ✅ |
| **ESLint** | 0 错误，2 警告 ⚠️ |
| **代码行数** | ~1200 行 TypeScript |
| **架构合规性** | 高 ✅ |
| **文档一致性** | 完全一致 ✅ |

### 已清理的废弃代码

| 清理项 | 位置 | 状态 |
|--------|------|------|
| `LegacyTaskCreatedPayload` | src/domain/events.ts | ✅ 已移除 |
| `LegacyPatchProposedPayload` | src/domain/events.ts | ✅ 已移除 |
| `LegacyPatchAppliedPayload` | src/domain/events.ts | ✅ 已移除 |
| 未使用的 `StoredEvent` import | src/application/patchService.ts | ✅ 已移除 |
| `core/` 目录 (旧代码) | 已迁移到 domain/application | ✅ 已完成 |
| `operations.ts` (deprecated) | 已迁移到 services | ✅ 已完成 |
| `sqliteEventStore.ts` | src/infra/ | ✅ 已移除 (Node 不稳定) |
| `sqlite.ts` | src/infra/ | ✅ 已移除 |
| SQLite 相关引用 | src/app/createApp.ts | ✅ 已清理 |

---

## 🔴 技术债务清单

### 高优先级 (P0) - V1 前必须解决

| # | 问题 | 影响 | 位置 | 修复方案 |
|---|------|------|------|---------|
| TD-1 | `as any` 类型逃逸 | 类型安全 | infra/jsonlEventStore.ts (2处) | 创建专用类型 |
| TD-2 | TUI 使用 console.log | 输出混乱 | src/tui/main.tsx:75 | 用状态展示替换 |

### 中优先级 (P1) - V1 期间解决

| # | 问题 | 影响 | 位置 | 修复方案 |
|---|------|------|------|---------|
| TD-3 | 投影每次全量重建 | 性能（>10k事件时） | taskService.ts:80 | 使用 checkpoint |
| TD-4 | 缺少并发控制 | 多进程竞争 | EventStore | 添加乐观锁 |
| TD-5 | node:sqlite 实验性警告 | ✅ 已解决 | （已移除） | 已移除 SQLite 后端 |

### 低优先级 (P2) - 技术改进

| # | 问题 | 影响 | 位置 | 修复方案 |
|---|------|------|------|---------|
| TD-6 | projector.test.ts 使用 any | 类型安全 | tests/projector.test.ts:24 | 使用 StoredEvent 类型 |
| TD-7 | JSONL 投影追加式存储 | 存储增长 | jsonlEventStore.ts | 添加压缩/归档 |

---

## 🔍 `as any` 类型问题详情

```
src/infra/jsonlEventStore.ts:69   - payload: evt.payload as any
src/infra/jsonlEventStore.ts:146  - payload: parsed.payload as any
```

**根因分析：** 
- `DomainEvent` 是 discriminated union，但在构造 `StoredEvent` 时 TypeScript 无法推断具体类型

**建议修复（V1）：**
```typescript
// 方案1: 使用类型断言辅助函数
function asStoredEvent(base: { id: number; streamId: string; seq: number; createdAt: string }, evt: DomainEvent): StoredEvent {
  return { ...base, type: evt.type, payload: evt.payload } as StoredEvent
}
```

---

## ✅ 文档一致性验证

### 已确认一致的项目

| 文档位置 | 代码位置 | 状态 |
|----------|----------|------|
| ARCHITECTURE.md L180: `claim_task` capability | src/domain/actor.ts:15 | ✅ 一致 |
| ARCHITECTURE.md L201: Task.title | src/domain/task.ts:65 | ✅ 一致 |
| ARCHITECTURE.md L212: Task.parentTaskId? | src/domain/task.ts (预留) | ✅ 一致 |
| ARCHITECTURE.md L81: RejectPatch 用例 | src/application/patchService.ts:58 | ✅ 一致 |
| ARCHITECTURE.md L82: PostFeedback 用例 | src/application/taskService.ts:105 | ✅ 一致 |
| ARCHITECTURE.md L110: LLMClient 端口 | M1 实现（已规划） | ✅ 符合计划 |

---

## 🚀 V1 准备清单

### 架构就绪度

| 组件 | M0 状态 | V1 需求 | 差距 |
|------|---------|---------|------|
| EventStore | ✅ 完成 | 无变化 | - |
| Projector | ✅ 基础 | 需 checkpoint | P1 |
| TaskService | ✅ 完成 | 无变化 | - |
| PatchService | ✅ 完成 | 无变化 | - |
| Actor 类型 | ✅ 定义 | 需权限校验 | P1 |
| LLMClient | ❌ 无 | 需添加 | M1 范围 |
| AgentRuntime | ❌ 无 | 需添加 | M1 范围 |
| ContextBuilder | ❌ 无 | 需添加 | M1 范围 |
| FileWatcher | ❌ 无 | 需添加 | M1 范围 |

> **说明**：LLMClient、AgentRuntime、ContextBuilder、FileWatcher 是 M1 的实现范围，不属于 M0 技术债务。M0 已按计划完成核心事件溯源架构。

### 推荐的 V1 实施顺序

```
V1.1: 添加 LLMClient 接口 (src/domain/ports/llmClient.ts)
      ├─ 定义 generate(), stream() 方法
      └─ 添加 Claude/OpenAI 适配器

V1.2: 实现 AgentRuntime (src/agents/runtime.ts)
      ├─ 订阅 Billboard 任务
      ├─ 调用 LLMClient 生成 Plan/Patch
      └─ 发射事件

V1.3: 实现 ContextBuilder (src/application/contextBuilder.ts)
      ├─ 读取 OUTLINE.md, BRIEF.md, STYLE.md
      ├─ 读取目标文件片段
      └─ 组装 prompt

V1.4: 添加 Drift 检测
      ├─ baseRevision 比对
      ├─ FileWatcher 集成
      └─ TaskNeedsRebase 事件

V1.5: 投影优化
      ├─ 持久化 checkpoint
      └─ 增量更新
```

---

## 🧹 代码质量建议

### 1. 修复 TUI console.log 问题 (TD-2)

**当前问题：**
```tsx
// src/tui/main.tsx:75
console.log(`${e.id} ${e.streamId}#${e.seq} ${e.type} ${JSON.stringify(e.payload)}`)
```

**建议修复：**
```tsx
// 在 TUI 中使用状态展示，而非 console.log
const [replayOutput, setReplayOutput] = useState<string[]>([])
// ...
setReplayOutput(events.map(e => `${e.id} ${e.streamId}#${e.seq} ${e.type}`))
// 然后在 JSX 中渲染 replayOutput
```

### 2. 修复测试文件 any 类型 (TD-6)

**当前问题：**
```typescript
// tests/projector.test.ts:24
function reduceTasksProjection(state: DeprecatedTasksProjectionState, event: any)
```

**建议修复：**
```typescript
import type { StoredEvent } from '../src/domain/events.js'
function reduceTasksProjection(state: DeprecatedTasksProjectionState, event: StoredEvent)
```

---

## ✅ 实施检查清单

### Phase 1: 已完成 ✅

- [x] 移除 deprecated legacy types
- [x] 移除未使用的 imports
- [x] 验证所有测试通过
- [x] 验证文档与代码一致性

### Phase 2: V1 准备（待做）

- [ ] 修复 TUI console.log 问题 (TD-2)
- [ ] 修复 `as any` 类型问题 (TD-1)
- [ ] 添加投影 checkpoint (TD-3)

---

## 📝 审计记录

### 2026-02-02 审计（更新）

**SQLite 移除：**
- 移除 `sqliteEventStore.ts` 和 `sqlite.ts`（Node 中不稳定）✅
- 清理 `createApp.ts` 中的 SQLite 引用 ✅
- 修复 ESLint `prefer-const` 错误 ✅
- 所有测试通过 ✅

**验证结果：**
- ARCHITECTURE.md 已包含 `claim_task` capability ✅
- ARCHITECTURE.md 已包含 `title` 和 `parentTaskId` 字段 ✅  
- ARCHITECTURE.md 已包含 `RejectPatch` 和 `PostFeedback` 用例 ✅
- 代码与文档完全一致 ✅

**清理的代码：**
- 移除 3 个 deprecated legacy types
- 移除 SQLite EventStore 实现
- 修复 2 个 ESLint 错误（prefer-const）

**确认的技术债务：**
- 2 处 `as any` 类型逃逸（ESLint 警告，已从 6 处减少）
- 1 处 TUI console.log 问题
- 1 处测试文件 any 类型
- 投影全量重建性能问题

**非技术债务（M1 范围）：**
- LLMClient、AgentRuntime、ContextBuilder、FileWatcher 按里程碑计划在 M1 实现

---

*文档版本: 2026-02-02*  
*相关文档: ARCHITECTURE.md, DOMAIN.md, MILESTONES.md, M0_STATUS.md*
