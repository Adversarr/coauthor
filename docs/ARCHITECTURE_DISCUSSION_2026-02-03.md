# CoAuthor Architecture Design Discussion Record

> Date: 2026-02-03
> Topic: Task Loop + Universal Interaction Events (UIP) + Tool Audit Decoupling (MVP Direction)

Applicability Note: This document is a direction reset record from 2026-02-03, intended to supersede previous statements in docs/ regarding the Plan/Patch protocol; subsequent specification documents (ARCHITECTURE.md, DOMAIN.md) should be aligned with this document.

---

## 1. Direction Update (Superseding Old Design)

This discussion makes three decisions regarding the existing design, directly superseding old drafts and constraints:

1. **Plan-first No Longer Holds**: No longer requiring any task to produce a plan before execution.
2. **More Generic Agent**: The Agent's sole responsibility is to complete the Task, essentially `start → loop until done` (on-demand UIP).
3. **Remove Patch at Event Level**: No longer maintaining "change representation" events like `PatchProposed/PatchApplied/...` in DomainEvent.

The key principle that follows is: **Task events only describe collaboration and decisions, not specific file modifications; file modifications go through an independent tool audit chain**.

---

## 2. Universal Interaction Protocol (UIP)

The problem UIP solves is: user interactions should not be tailored to specific business types (plan/patch/other) with custom events. The system only needs to express two things:
- The system presents an interaction request to the user
- The user responds to that request

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
      | 'choose_strategy'       // Choose solution/path
      | 'request_info'          // Ask user for more information when missing
      | 'confirm_risky_action'  // Require user to assume risk (e.g., writing files/running commands)
      | 'assign_subtask'        // Subtask delegation
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

## 3. Generic Agent: `confirm → loop until done`

### 3.1 Agent Responsibility Boundaries

The Agent only cares about "how to complete the Task." During execution, the Agent may need to:
- Request user confirmation/choice or supplement information through UIP
- Call tools to complete specific actions (e.g., edit file / run command / read file)

Key point: **function call (tool invocation) uses a separate audit system**, not Task domain events. Task events do not record specific file diffs or file write details, only record "when user needs to make decisions/provide information/how task status changes".

### 3.2 Standard Workflow Skeleton

```text
1) TaskCreated
2) TaskStarted
3) LOOP:
     - agent makes one step progress (text output or tool call)
     - If missing info/need decision: UserInteractionRequested → UserInteractionResponded
     - Until done / failed / canceled
4) TaskCompleted | TaskFailed | TaskCanceled
```

This workflow should be very similar to LLM agent workflows in the market.

---

## 4. Event Model (MVP: No Patch, No Plan)

### 4.1 DomainEvent (Recommended Minimum Set)

```typescript
type DomainEvent =
  // Task lifecycle
  | TaskCreated
  | TaskStarted
  | TaskCompleted
  | TaskFailed
  | TaskCanceled

  // Universal interaction
  | UserInteractionRequested
  | UserInteractionResponded
```

> Note: Under this direction, Task "execution details" are recorded through tool audit logs; DomainEvent remains minimalist, clear, and extensible.

### 4.2 How to Express "Confirm Task"

No additional `TaskConfirmed` event is introduced. If scope clarification or user choice is needed, use on-demand:
- `UserInteractionRequested(purpose=request_info|choose_strategy)`
- `UserInteractionResponded(...)`

---

## 5. Simplified Event Flow (UIP + Task Loop)

Event flow for the same Task (in chronological order):

```text
Event 1: TaskCreated
Event 2: TaskStarted
Event 3..N: (zero or more) UserInteractionRequested / UserInteractionResponded

Event N+1: TaskCompleted | TaskFailed | TaskCanceled
```

### 5.1 High-Risk Actions Requiring User Confirmation (Example)

When the Agent is about to execute irreversible or high-risk tool calls (e.g., writing files, batch replacement, running commands that modify the environment), first obtain explicit confirmation through UIP:

```text
UserInteractionRequested(purpose=confirm_risky_action, kind=Confirm, display.contentKind=Diff|PlainText)
UserInteractionResponded(selectedOptionId=approve|reject, comment?)
```

### 5.2 Subtask Interaction (Interaction Layer Only, V1)

When the Orchestrator needs the user to select a subtask executor:

```text
UserInteractionRequested(purpose=assign_subtask, kind=Select, options=[agentA, agentB, ...])
UserInteractionResponded(selectedOptionId=agentB)
```

Whether subtask creation and completion require domain events is a future design decision (optional). This discussion only determines: **interactions go through UIP uniformly**.

---

## 6. Agent Tool Invocation Mechanism & Auditing (Tool Use)

### 6.1 Core Definition: Agent's "Hands and Feet"

Tool invocation (Tool Use / Function Calling) is the **only way** for the Agent to interact with the external environment (file system, Shell, browser, etc.).
This directly corresponds to the Tool Use capability provided by modern LLMs like OpenAI or Claude, or simulated tool invocation based on structured output (XML/JSON).

### 6.2 Unified Abstraction of Two Implementation Modes

CoAuthor should internally use `ToolRegistry` and `ToolExecutor` to shield differences in underlying models, providing a unified tool invocation protocol externally.

#### A. Native Tool Use (OpenAI / Claude)
- **Mechanism**: Pass `tools` definitions (JSON Schema) in API requests.
- **Behavior**: Model directly returns `tool_calls` field (containing `function.name` and `function.arguments`).
- **Advantage**: Native model support, high accuracy, capable of handling complex parameter structures.

#### B. Structured Output (XML / JSON)
- **Mechanism**: Agree on specific output formats through System Prompt (e.g., XML tags).
- **Behavior**: Model outputs content like `<tool_code>...</tool_code>` or `<tool_use>...</tool_use>` in the text stream.
- **Advantage**: Strong universality, suitable for models that don't support Native Tool Use.

**CoAuthor's Unified Processing Flow:**
Regardless of whether the underlying implementation is Native or XML, the system will parse it into a unified internal structure `ToolCallRequest`, then distribute for execution.

### 6.3 Tool Invocation Lifecycle & Auditing

To ensure security and traceability, every tool invocation must go through strict lifecycle management and be recorded in an independent AuditLog.

#### Flow Diagram
```text
[Agent]
   | (Initiate call)
   v
[System Interceptor]
   | 1. Parse request (Parse)
   | 2. Check permission (Check Permission) -> If high risk, trigger UIP (InteractionRequested)
   | 3. Log request (Log Request)
   v
[Tool Executor]
   | (Execute specific logic: editFile / runCommand / searchCode ...)
   v
[System Interceptor]
   | 1. Capture result (Capture Output / Error)
   | 2. Log completion (Log Completion)
   v
[Agent] (Receive ToolResult, continue thinking)
```

#### Audit Log Structure (AuditLog)

AuditLog is an append-only log independent of DomainEvent, used to completely record the "scene" of tool calls.

```typescript
type JsonObject = { [key: string]: any } // Simplified definition, actual should be strict JSON structure

type AuditLogEvent =
  | {
      type: 'ToolCallRequested'
      payload: {
        toolCallId: string       // Unique ID
        toolName: string         // e.g. "editFile", "runCommand"
        authorActorId: string    // Agent or User initiating the call
        taskId: string           // Associated Task
        input: JsonObject        // Specific parameters, must be JSON object
        timestamp: number
      }
    }
  | {
      type: 'ToolCallCompleted'
      payload: {
        toolCallId: string
        authorActorId: string
        taskId: string
        output: JsonObject       // Execution result, must be JSON object (e.g. { stdout: "..." })
        isError: boolean
        durationMs: number
        timestamp: number
      }
    }
```

### 6.4 Key Tool Examples

CoAuthor's core capabilities will be exposed to the Agent through the following basic tools:

1.  **File Operations**:
    -   `readFile(path)`: Read file content (usually read-only safe).
    -   `editFile(path, oldStr, newStr)`: Request to modify file (high risk, needs audit, may require confirmation).
    -   `listFiles(path)`: Browse directory structure.

2.  **Command Execution**:
    -   `runCommand(command)`: Execute Shell command (high risk, must confirm).

3.  **Knowledge Retrieval**:
    -   `searchCode(query)`: Semantic search of codebase.
    -   `grep(pattern)`: Regex search.

4.  **Interaction Request** (This is also a special Tool):
    -   `askUser(question)`: Actually triggers `UserInteractionRequested` event, waits for `UserInteractionResponded` then returns as Tool Result.

---

## 7. Conflict Records with Existing docs/ Documents (For Subsequent Convergence)

This discussion draft has clearly superseded the old design, so there are numerous conflicts in the current specification documents like `docs/ARCHITECTURE.md`, `docs/DOMAIN.md`, etc. Typical examples include:
- The `Plan-first + Patch-first + Review-first` protocol needs rewriting (at least Plan-first and Patch-first no longer apply).
- Events like `PatchProposed/PatchApplied/PatchConflicted` are removed or migrated to tool audit layer expression under this direction.
- The binding method of existing CLI patch commands with DomainEvent needs resetting (if CLI commands are to be retained, they should map to tool calls and UIP interactions, not Patch events).

This file serves as a "discussion record", here only records conflicts, does not synchronously modify other documents in this change.

---

# Part 2: Agent State Management and Task-Context Relationship (2026-02-03 Evening)

> **✅ Resolved**: On 2026-02-03 evening, introduced `ConversationStore` port to implement conversation history persistence.
> See `src/domain/ports/conversationStore.ts` and `src/infra/jsonlConversationStore.ts` for details.

## 1. Initial Issues Discovered (Fixed)

### 1.1 Duplicate Type Design ✅ Fixed

**Original Problem**:
- `AgentContext.conversationHistory` was always an empty array
- Agent rebuilt `messages` array locally each time
- `conversationHistory` and `messages` referred to the same concept but were split

**Solution**:
- `AgentRuntime` loads history via `ConversationStore.getMessages(taskId)`
- `AgentContext.conversationHistory` is now `readonly LLMMessage[]`, preloaded by Runtime
- Added `AgentContext.persistMessage(message)` callback, Agent calls it and message is persisted
- `DefaultCoAuthorAgent.#toolLoop()` no longer maintains `messages` array locally, directly uses `context.conversationHistory`

### 1.2 Cross-Resume State Loss ✅ Fixed

**Original Problem**: No mechanism to maintain conversation history between pause/resume.

**Solution**:
```
New Process:
messages = [system, user] → persistMessage() → LLM → persistMessage(assistant) → Tool → persistMessage(tool)
   ↓
Encounter risky tool, yield interaction, return
   ↓
#toolLoop ends, but messages already persisted to ConversationStore!
   ↓
Waiting for user response... (program can restart, state not lost)
   ↓
After user response, Agent.run() restarts
   ↓
conversationHistory = ConversationStore.getMessages(taskId) ← Complete recovery!
```

## 2. Three-Layer Storage Responsibility Separation

After introducing `ConversationStore`, the system forms clear three-layer storage responsibility separation:

| Storage | Responsibility | Interaction Type |
|---------|----------------|------------------|
| **EventStore** | Collaboration and Decisions (Task lifecycle, UIP interactions) | User ↔ Agent |
| **AuditLog** | Tool Execution Audit (readFile, editFile, runCommand, etc.) | Agent ↔ Tools/Files |
| **ConversationStore** | Agent Execution Context (LLM conversation history) | Agent ↔ LLM |

This separation ensures:
1. DomainEvent remains clear, only records "what decisions happened"
2. AuditLog provides complete tool call tracking, supports file modification audit
3. ConversationStore supports Agent state recovery, no need to store large amounts of LLM conversation content in events
