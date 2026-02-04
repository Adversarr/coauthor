# CoAuthor 架构设计讨论记录

> 日期：2026-02-03
> 主题：Task 闭环 + 通用交互事件 (UIP) + 工具审计解耦（MVP 方向）

适用性说明：本文档是 2026-02-03 的方向重设记录，用于覆盖此前 docs/ 中关于 Plan/Patch 协议的旧口径；后续规范文档（ARCHITECTURE.md、DOMAIN.md）应以本文为准完成对齐。

---

## 1. 方向更新（覆盖旧设计）

本次讨论对既有设计做出三条决定，直接覆盖旧稿与旧约束：

1. **Plan-first 不再成立**：不再要求任何任务必须先产出 plan 才能执行。
2. **Agent 更通用**：Agent 的唯一职责是完成 Task，本质是 `start → loop until done`（按需 UIP）。
3. **事件层面移除 Patch**：不再在 DomainEvent 中维护 `PatchProposed/PatchApplied/...` 这类“变更表示”事件。

随之而来的关键原则是：**Task 事件只描述协作与决策，不描述具体文件修改；文件修改走独立的工具审计链路**。

---

## 2. 通用交互协议（UIP）

UIP 解决的问题是：用户交互不应为某个业务类型（plan/patch/其他）量身定制事件。系统只需要表达两件事：
- 系统向用户提出一个交互请求
- 用户对该请求做出响应

### 2.1 `UserInteractionRequested`

```typescript
type UserInteractionRequested = {
  type: 'UserInteractionRequested'
  payload: {
    interactionId: string
    taskId: string
    authorActorId: string

    kind: 'Select' | 'Confirm' | 'Input' | 'Composite'

    purpose:
      | 'choose_strategy'       // 选择方案/路径
      | 'request_info'          // 缺信息时向用户追问
      | 'confirm_risky_action'  // 需要用户承担风险（例如写文件/执行命令等）
      | 'assign_subtask'        // 子任务委派
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
```

### 2.2 `UserInteractionResponded`

```typescript
type UserInteractionResponded = {
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

---

## 3. 通用 Agent：`confirm → loop until done`

### 3.1 Agent 的职责边界

Agent 只关心“如何把 Task 做完”。在执行过程中，Agent 可能需要：
- 通过 UIP 请求用户确认选择/补充信息
- 调用工具完成具体动作（例如 edit file / run command / read file）

关键点：**function call（工具调用）采用另一个审计系统**，不是 Task 的领域事件。Task 事件不记录具体文件 diff、不记录文件写入细节，只记录“何时需要用户做决定/提供信息/任务状态如何变化”。

### 3.2 标准工作流骨架

```text
1) TaskCreated
2) TaskStarted
3) LOOP:
     - agent 做一步推进（文本输出或者工具调用）
     - 若缺信息/需要决策：UserInteractionRequested → UserInteractionResponded
     - 直到 done / failed / canceled
4) TaskCompleted | TaskFailed | TaskCanceled
```

这个流程应该和市面上的llm agent的工作流非常相似。

---

## 4. 事件模型（MVP：无 Patch、无 Plan）

### 4.1 DomainEvent（建议最小集合）

```typescript
type DomainEvent =
  // Task 生命周期
  | TaskCreated
  | TaskStarted
  | TaskCompleted
  | TaskFailed
  | TaskCanceled

  // 通用交互
  | UserInteractionRequested
  | UserInteractionResponded
```

> 说明：本方向下，Task 的“执行细节”通过工具审计记录；DomainEvent 保持极简、清晰、可扩展。

### 4.2 “确认 Task”如何表达

不引入额外的 `TaskConfirmed` 事件。若需要澄清范围或让用户做选择，按需使用：
- `UserInteractionRequested(purpose=request_info|choose_strategy)`
- `UserInteractionResponded(...)`

---

## 5. 简化后的事件流（UIP + Task 闭环）

同一个 Task 的事件流（按时间顺序）：

```text
Event 1: TaskCreated
Event 2: TaskStarted
Event 3..N: (零个或多个) UserInteractionRequested / UserInteractionResponded

Event N+1: TaskCompleted | TaskFailed | TaskCanceled
```

### 5.1 需要用户确认的高风险动作（示例）

当 Agent 即将执行不可逆或高风险的工具调用（例如写文件、批量替换、运行会修改环境的命令）时，先用 UIP 取得明确确认：

```text
UserInteractionRequested(purpose=confirm_risky_action, kind=Confirm, display.contentKind=Diff|PlainText)
UserInteractionResponded(selectedOptionId=approve|reject, comment?)
```

### 5.2 Subtask 的交互（仅交互层，V1）

当 Orchestrator 需要用户选择子任务执行者时：

```text
UserInteractionRequested(purpose=assign_subtask, kind=Select, options=[agentA, agentB, ...])
UserInteractionResponded(selectedOptionId=agentB)
```

子任务的创建与完成是否需要领域事件属于后续设计（可选）。本讨论稿只确定：**交互统一走 UIP**。

---

## 6. Agent 工具调用机制与审计（Tool Use）

### 6.1 核心定义：Agent 的“手和脚”

工具调用（Tool Use / Function Calling）是 Agent 与外部环境（文件系统、Shell、浏览器等）交互的**唯一方式**。
这直接对应于 OpenAI 或 Claude 等现代 LLM 提供的 Tool Use 能力，或者是基于结构化输出（XML/JSON）的模拟工具调用。

### 6.2 两种实现模式的统一抽象

CoAuthor 内部应通过 `ToolRegistry` 和 `ToolExecutor` 屏蔽底层模型的差异，对外提供统一的工具调用协议。

#### A. Native Tool Use (OpenAI / Claude)
- **机制**：在 API 请求中传入 `tools` 定义（JSON Schema）。
- **表现**：模型直接返回 `tool_calls` 字段（含 `function.name` 和 `function.arguments`）。
- **优势**：模型原生支持，准确率高，能够处理复杂的参数结构。

#### B. Structured Output (XML / JSON)
- **机制**：通过 System Prompt 约定特定的输出格式（例如 XML 标签）。
- **表现**：模型在文本流中输出类似 `<tool_code>...</tool_code>` 或 `<tool_use>...</tool_use>` 的内容。
- **优势**：通用性强，适用于不支持 Native Tool Use 的模型。

**CoAuthor 的统一处理流：**
无论底层是 Native 还是 XML，系统都会将其解析为统一的内部结构 `ToolCallRequest`，然后再分发执行。

### 6.3 工具调用的生命周期与审计

为了保证安全与可追溯，每一次工具调用都必须经过严格的生命周期管理，并记录到独立的 AuditLog 中。

#### 流程图解
```text
[Agent] 
   | (发起调用)
   v
[System Interceptor]
   | 1. 解析请求 (Parse)
   | 2. 权限检查 (Check Permission) -> 若高风险，触发 UIP (InteractionRequested)
   | 3. 记录请求日志 (Log Request)
   v
[Tool Executor]
   | (执行具体逻辑：editFile / runCommand / searchCode ...)
   v
[System Interceptor]
   | 1. 捕获结果 (Capture Output / Error)
   | 2. 记录完成日志 (Log Completion)
   v
[Agent] (接收 ToolResult，继续思考)
```

#### 审计日志结构 (AuditLog)

AuditLog 是独立于 DomainEvent 的追加写日志，用于完整记录工具调用的“现场”。

```typescript
type JsonObject = { [key: string]: any } // 简化定义，实际应为严格的 JSON 结构

type AuditLogEvent =
  | {
      type: 'ToolCallRequested'
      payload: {
        toolCallId: string       // 唯一 ID
        toolName: string         // e.g. "editFile", "runCommand"
        authorActorId: string    // 发起调用的 Agent 或 User
        taskId: string           // 关联的 Task
        input: JsonObject        // 具体的参数，必须是 JSON 对象
        timestamp: number
      }
    }
  | {
      type: 'ToolCallCompleted'
      payload: {
        toolCallId: string
        authorActorId: string
        taskId: string
        output: JsonObject       // 执行结果，必须是 JSON 对象 (如 { stdout: "..." })
        isError: boolean
        durationMs: number
        timestamp: number
      }
    }
```

### 6.4 关键工具示例

CoAuthor 的核心能力将通过以下基础工具暴露给 Agent：

1.  **文件操作**：
    -   `readFile(path)`: 读取文件内容（通常是只读安全）。
    -   `editFile(path, oldStr, newStr)`: 申请修改文件（高风险，需审计，可能需确认）。
    -   `listFiles(path)`: 浏览目录结构。

2.  **命令执行**：
    -   `runCommand(command)`: 执行 Shell 命令（高风险，必须确认）。

3.  **知识检索**：
    -   `searchCode(query)`: 语义搜索代码库。
    -   `grep(pattern)`: 正则搜索。

4.  **交互请求**（这也是一种特殊的 Tool）：
    -   `askUser(question)`: 实际上是触发 `UserInteractionRequested` 事件，等待 `UserInteractionResponded` 后作为 Tool Result 返回。

---

## 7. 与 docs/ 现有文档的冲突记录（供后续统一收敛）

本讨论稿已明确覆盖旧设计，因此当前 `docs/ARCHITECTURE.md`、`docs/DOMAIN.md` 等规范文档中存在大量冲突，典型包括：
- `Plan-first + Patch-first + Review-first` 的协议需要重写（至少 Plan-first 与 Patch-first 不再成立）。
- `PatchProposed/PatchApplied/PatchConflicted` 等事件在本方向下被移除或迁移到工具审计层表达。
- 既有 CLI patch 命令与 DomainEvent 的绑定方式需要重设（若继续保留 CLI 命令，也应映射为工具调用与 UIP 交互，而不是 Patch 事件）。

本文件作为"讨论记录"，此处只记录冲突，不在本次改动中同步修改其他文档。

---

# 第二部分：Agent 状态管理与 Task-Context 关系（2026-02-03 晚）

> **✅ 已解决**：2026-02-03 晚引入 `ConversationStore` 端口，实现对话历史持久化。
> 详见 `src/domain/ports/conversationStore.ts` 和 `src/infra/jsonlConversationStore.ts`。

## 一、初始发现的问题（已修复）

### 1.1 重复的类型设计 ✅ 已修复

**原问题**：
- `AgentContext.conversationHistory` 始终是空数组
- Agent 每次都在本地重建 `messages` 数组
- `conversationHistory` 和 `messages` 指代同一个概念，但被割裂了

**解决方案**：
- `AgentRuntime` 通过 `ConversationStore.getMessages(taskId)` 加载历史
- `AgentContext.conversationHistory` 现在是 `readonly LLMMessage[]`，由 Runtime 预加载
- 新增 `AgentContext.persistMessage(message)` 回调，Agent 调用后消息被持久化
- `DefaultCoAuthorAgent.#toolLoop()` 不再本地维护 `messages` 数组，直接使用 `context.conversationHistory`

### 1.2 跨 Resume 状态丢失 ✅ 已修复

**原问题**：暂停/恢复之间没有机制保持对话历史。

**解决方案**：
```
新流程：
messages = [system, user] → persistMessage() → LLM → persistMessage(assistant) → Tool → persistMessage(tool)
   ↓
遇到 risky 工具，yield interaction, return
   ↓
#toolLoop 结束，但消息已持久化到 ConversationStore！
   ↓
等待用户响应...（程序可以重启，状态不丢失）
   ↓
用户响应后，Agent.run() 重新开始
   ↓
conversationHistory = ConversationStore.getMessages(taskId)  ← 完整恢复！
```

## 二、三层存储职责分离

引入 `ConversationStore` 后，系统形成清晰的三层存储职责分离：

| 存储 | 职责 | 交互类型 |
|------|------|----------|
| **EventStore** | 协作与决策（Task 生命周期、UIP 交互） | User ↔ Agent |
| **AuditLog** | 工具执行审计（readFile, editFile, runCommand 等） | Agent ↔ Tools/Files |
| **ConversationStore** | Agent 执行上下文（LLM 对话历史） | Agent ↔ LLM |

这种分离确保：
1. DomainEvent 保持清晰，只记录"发生了什么决策"
2. AuditLog 提供完整的工具调用追踪，支持文件修改审计
3. ConversationStore 支持 Agent 状态恢复，无需在事件中存储大量 LLM 对话内容
