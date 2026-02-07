# CoAuthor Architecture Design Document

> Version: V0.1  
> Last Updated: 2026-02-03  
> Status: Normative Specification

This document defines the architectural design principles, layered structure, and core concepts of CoAuthor. It serves as the "constitution" for system design, and all implementations must comply with it.

This specification has been updated according to the direction reset in [ARCHITECTURE_DISCUSSION_2026-02-03.md](ARCHITECTURE_DISCUSSION_2026-02-03.md): Plan/Patch events are no longer used as the collaboration protocol; Task events only describe collaboration and decisions, while specific file modifications and command executions follow an independent Tool Audit chain.

---

## 1. Design Principles (6 Rules)

### 1.1 All inputs become Tasks, all outputs enter the Event Stream

Regardless of whether a request is initiated through CLI chat, slash commands, future TODO comments, or an Overleaf plugin, it is uniformly encapsulated as a **Task**.

All "collaboration and decision" outputs (task lifecycle, interaction requests/responses, key choices) are written to the event stream as **DomainEvents**, forming a replayable collaboration history.

"Execution details" such as file modifications and command executions do not enter DomainEvents. Instead, they are completed through Tool Use and written to an independent **AuditLog** (Tool Audit Log).
Conversation history between the Agent and LLM (execution context) is stored in an independent **ConversationStore**, supporting state recovery across UIP pauses and program restarts.

Separation of Concerns: Three-Layer Storage:
- **EventStore**: User ↔ Agent collaboration decisions
- **AuditLog**: Agent ↔ Tools/Files execution audit
- **ConversationStore**: Agent ↔ LLM conversation context

### 1.2 UIP: Universal Interaction Protocol First

User interactions do not use custom events tailored for specific business types (like legacy plan/patch concepts). The system uses a unified UIP to express two things:
1. The system issues an interaction request to the user (`UserInteractionRequested`)
2. The user responds to that request (`UserInteractionResponded`)

### 1.3 User manual modifications will not be overwritten

The system must avoid "blind overwriting." For high-risk/irreversible Tool Use (writing files, bulk replacement, executing commands that modify the environment, etc.), explicit UIP confirmation (`purpose=confirm_risky_action`) must be obtained first, and the request and result must be fully recorded in the Tool Audit Log.

### 1.4 CLI is just an Adapter

The CLI/TUI is only responsible for:
1. Converting user input into Tasks/Events and posting them to the Billboard
2. Subscribing to the event stream and rendering it

When connecting an Overleaf plugin or Web UI in the future, only a new Adapter needs to be added, without affecting the core.

### 1.5 No granular Task classification

A Task itself is a general carrier. "What this task is" is determined by the **routed Agent + that Agent's workflow**.

Strongly typed enums like `TaskType = 'draft' | 'revise' | 'tweak'` are avoided.

### 1.6 Actors as First-Class Citizens

Both Users and LLM Agents are **Actors**. The only differences are:
- Permissions/capabilities
- Whether they can execute certain Tool Use (e.g., writing files, executing commands)

---

## 2. Layered Architecture

Uses the **Hexagonal Architecture (Ports-and-Adapters)** + **Event Sourcing** + **CQRS** patterns.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Interfaces Layer                       │   │
│  │  (Adapters: CLI REPL / TUI / Overleaf Plugin / Web)     │   │
│  │                                                          │   │
│  │  Responsibilities:                                       │
│  │  - Convert external input into Task/Event                │
│  │  - Subscribe to event stream and render UI               │
│  │  - Contain no business logic                             │
│  │  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│                               ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Application Layer                      │   │
│  │                                                          │   │
│  │  UseCases:                                               │
│  │  - CreateTask: Create a task (TaskCreated)               │
│  │  - RunTask: Run Agent (TaskStarted → ... → Completed)    │
│  │  - CancelTask: Cancel a task                             │
│  │  - RequestUserInteraction: Initiate UIP request          │
│  │  - RespondUserInteraction: Submit UIP response           │
│  │  - ReplayEvents: Replay events                           │
│  │                                                          │
│  │  Services:                                               │
│  │  - ContextBuilder: Build Agent context                   │
│  │  - Scheduler: Task scheduling strategy (V1)              │
│  │  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│                               ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Domain Layer                         │   │
│  │               (Pure Logic, No External Deps)             │   │
│  │                                                          │   │
│  │  Entities:                                               │
│  │  - Actor: Participant (User / Agent)                     │
│  │  - Task: Task carrier                                    │
│  │  - Artifact: Asset (tex / outline / figure / code)       │
│  │                                                          │
│  │  Events (Zod Schemas):                                   │
│  │  - DomainEvent: Discriminated union of all events        │
│  │  - See DOMAIN.md for full definitions                    │
│  │                                                          │
│  │  Ports (Interfaces):                                     │
│  │  - EventStore: Event storage interface                   │
│  │  - ConversationStore: Conversation history interface     │
│  │  - AuditLog: Tool audit log interface                    │
│  │  - ArtifactStore: Asset R/W interface                    │
│  │  - LLMClient: LLM call interface                         │
│  │                                                          │
│  │  Policies (Pure Functions):                              │
│  │  - SchedulerPolicy: Execution priority rules              │
│  │  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│                               ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Infrastructure Layer                    │   │
│  │                                                          │   │
│  │  EventStore Implementations:                             │   │
│  │  - JsonlEventStore: Current default JSONL implementation │   │
│  │                                                          │   │
│  │  ConversationStore Implementations:                      │
│  │  - JsonlConversationStore: JSONL storage for history     │
│  │                                                          │
│  │  Other Adapters:                                         │
│  │  - LLMProviders: Claude/OpenAI/Local adapters            │
│  │  - ToolRegistry/ToolExecutor: Tool reg & execution       │
│  │  - AuditLogWriter: Tool audit log append-only writer     │
│  │  - LatexCompiler: latexmk adapter                        │
│  │  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                               +                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Agents Layer                         │   │
│  │           (Parallel to Infrastructure, uses Ports)       │   │
│  │                                                          │   │
│  │  RuntimeManager (central event router):                  │
│  │  - Subscribes to EventStore.events$                      │
│  │  - Routes events by taskId to task-scoped runtimes       │
│  │  - Manages AgentRuntime lifecycle (create/destroy)       │
│  │  - Agent catalogue (multi-agent registration)            │
│  │                                                          │
│  │  AgentRuntime (task-scoped executor):                    │
│  │  - One runtime per task (scalar state, no Maps/Sets)     │
│  │  - Agent loop orchestration + output handling            │
│  │  - Cooperative pause/cancel signalling                   │
│  │  - Instruction queueing during unsafe states             │
│  │                                                          │
│  │  Agents:                                                 │
│  │  - DefaultCoAuthorAgent: V0 default general agent        │
│  │  - [V1] OrchestratorAgent: Creates subtasks/schedules    │
│  │  - [V1] SpecialistAgents: Domain-specific agents         │
│  │                                                          │
│  │  V0 Design: User → Billboard → Default Agent (chat-like) │
│  │  V1 Extension: OrchestratorAgent dispatches subtasks     │
│  │                                                          │
│  │  Agent only depends on Ports, no direct Infra calls      │
│  │  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Concept Definitions

### 3.1 Actor

An Actor is an entity capable of participating in task collaboration. Both Users and Agents are Actors.

```typescript
type ActorKind = 'human' | 'agent'

type Actor = {
  id: string
  kind: ActorKind
  displayName: string
  capabilities: ActorCapability[]
  defaultAgentId?: string  // human only, default routing agent
}

type ActorCapability = 
  | 'tool_read_file'   // Can read files/assets
  | 'tool_edit_file'   // Can modify files (high-risk)
  | 'tool_run_command' // Can execute commands (high-risk)
  | 'run_latex_build'  // Can run LaTeX compilation
  | 'read_assets'      // Can read assets
  | 'create_task'      // Can create tasks
  // V1: | 'claim_task' // Can claim tasks (Agent specific)
```

### 3.2 Task

A Task is a unified task carrier. V0 does not use strong typing or routing—all tasks are sent directly to the default Agent.

```typescript
type TaskStatus = 
  | 'open'            // Pending
  | 'in_progress'     // Executing
  | 'awaiting_user'   // Waiting for interaction (UIP driven)
  | 'paused'          // Paused
  | 'done'            // Completed
  | 'failed'          // Failed (terminal state)
  | 'canceled'        // Canceled

type TaskPriority = 'foreground' | 'normal' | 'background'

type Task = {
  taskId: string
  title: string            // Task title (for display, required)
  createdBy: string        // ActorId
  agentId: string          // V0: Designated Agent at creation
  priority: TaskPriority
  status: TaskStatus
  intent: string           // User intent (free text)
  artifactRefs?: ArtifactRef[]  // Associated assets/locations
  baseRevisions?: Record<string, string>  // File revision snapshots at creation
  createdAt: string
  parentTaskId?: string    // V1 Reserved: Parent task ID (subtask support)
}
```

### 3.3 ArtifactRef

Used to locate files, positions, or assets associated with a task.

```typescript
type ArtifactRef = 
  | { kind: 'file_range'; path: string; lineStart: number; lineEnd: number }
  | { kind: 'outline_anchor'; sectionId: string }
  | { kind: 'asset'; assetId: string }
  | { kind: 'citation'; citeKey: string }
```

### 3.4 Artifact

Unified abstraction for all paper-related files/assets.

```typescript
type ArtifactType = 
  | 'tex'         // LaTeX source file
  | 'outline_md'  // OUTLINE.md
  | 'brief_md'    // BRIEF.md
  | 'style_md'    // STYLE.md
  | 'bib'         // BibTeX
  | 'figure'      // Figure/Chart
  | 'data'        // Data
  | 'code'        // Code
  | 'other'

type Artifact = {
  id: string
  type: ArtifactType
  path: string
  revision: string    // hash or mtime+size
  metadata?: Record<string, unknown>  // source/purpose/message for figures/code
}
```

---

## 4. Billboard (Collaboration Hub)

Billboard is the core component of V0, responsible for:

1. **Unified Entry**: All Adapters only need to call Application Services (eventually appending DomainEvents to the EventStore).
2. **Unified Exit**: UI and Agents can subscribe to `EventStore.events$` for the event stream; task read models are derived via projections.
3. **Audit and Replayability**: Any anomalies can be reviewed through event replay.
4. **High Scalability**: Future multi-Agent, multi-UI, and multi-entry systems will not change the core.

### 4.1 Components

```
Billboard (Concept) = EventStore + Projector + RxJS events$
```

- **EventStore (Persistence)**: Append-only event storage, supports replay.
- **Projector (Projection)**: Derives read models (TaskView) from the event stream.
- **events$ (Real-time)**: EventStore exposes an RxJS Observable for UI and Agent subscriptions.

### 4.2 API Design

```typescript
// V0.1 Current implementation doesn't have a separate Billboard abstraction; 
// the composition root (createApp) injects these capabilities directly:
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

## 5. Agent Runtime

### 5.1 Unified Interface

All Agents implement the same interface:

```typescript
interface Agent {
  readonly id: string
  readonly displayName: string
  
  // Execute task, notify runtime via AgentOutput
  run(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput>
}

// Agent output types
type AgentOutput = 
  | { kind: 'text'; content: string }
  | { kind: 'tool_call'; call: ToolCallRequest }
  | { kind: 'interaction'; request: InteractionRequest & { interactionId: string } }
  | { kind: 'done'; summary?: string }
  | { kind: 'failed'; reason: string }

// Agent context
type AgentContext = {
  llm: LLMClient
  tools: ToolRegistry
  baseDir: string
  conversationHistory: readonly LLMMessage[]  // Loaded from ConversationStore
  pendingInteractionResponse?: UserInteractionRespondedPayload
  toolResults: Map<string, ToolResult>
  confirmedInteractionId?: string
  persistMessage: (message: LLMMessage) => void  // Persists new messages
}
```

### 5.2 Standard Workflow Skeleton

All writing agents follow a unified skeleton:

```
1. Start        → emit TaskStarted
2. LOOP:
     - Agent progresses task (calls tools: readFile, editFile, listFiles, runCommand)
     - Tool call records written to AuditLog (not DomainEvent)
     - If info is missing/decision needed: UserInteractionRequested(purpose=request_info|choose_strategy) → UserInteractionResponded
     - If high-risk tool action imminent: UserInteractionRequested(purpose=confirm_risky_action)
3. Done/Fail/Cancel → emit TaskCompleted | TaskFailed | TaskCanceled
```

### 5.3 LLM Profile Strategy

Agents choose different models based on the step:

- **fast**: Routing/summarization/light rewriting
- **writer**: High-quality LaTeX text generation
- **reasoning**: Strategy selection, consistency checks, extracting descriptions from code

### 5.4 Architecture: RuntimeManager + Task-Scoped AgentRuntime

`RuntimeManager` is the single subscriber to `EventStore.events$`. It owns a
`Map<taskId, AgentRuntime>` and routes events to the correct task-scoped runtime.
Runtimes are created on `TaskCreated` / `TaskResumed` and destroyed when tasks
reach terminal states (`done`, `failed`, `canceled`).

`AgentRuntime` manages exactly ONE task. All state is scalar (booleans, arrays) —
no Maps or Sets. This eliminates multi-task bugs (key collisions, stale entries,
memory leaks).

### 5.5 Concurrency & State Management

To ensure conversation history integrity (Tool Use Protocol), the Runtime enforces:

1.  **Safe Pause**:
    - Pausing (`/pause`) is cooperative. It only takes effect when the conversation history is in a "Safe Point" (no pending tool calls).
    - If a tool batch is running, the Runtime waits for all tool results to be persisted before pausing.

2.  **Instruction Queueing**:
    - New instructions (`/continue`, `/refine`) arriving during unsafe states (e.g., while tools are executing) are queued in `AgentRuntime.#pendingInstructions`.
    - They are injected into history only when the state becomes safe (after tool results are written).
    - This prevents User messages from interleaving between Tool Calls and Tool Results.
    - After `execute()` completes, `RuntimeManager` drains any remaining queued instructions via a drain loop.

3.  **Auto-Repair**:
    - On resume/start, the Runtime scans for "dangling" tool calls (missing results).
    - If results cannot be recovered from AuditLog, it injects an "Interrupted" error result to close the conversation loop, allowing the task to proceed.

---

## 6. Directory Structure

```
src/
├── index.ts                 # CLI entry
│
├── domain/                  # Domain Layer (Pure logic)
│   ├── actor.ts            # Actor type definitions
│   ├── task.ts             # Task/TaskStatus type definitions
│   ├── artifact.ts         # Artifact type definitions
│   ├── events.ts           # DomainEvent Zod schemas (10 event types)
│   └── ports/              # Port interface definitions
│       ├── eventStore.ts   # EventStore interface
│       ├── conversationStore.ts  # ConversationStore interface
│       ├── artifactStore.ts # ArtifactStore interface (optional for V0)
│       ├── llmClient.ts    # LLMClient interface
│       ├── tool.ts         # Tool/ToolRegistry/ToolExecutor interface
│       └── auditLog.ts     # AuditLog interface
│
├── application/             # Application Layer (Use cases/Services)
│   ├── taskService.ts      # Task CRUD + Projections
│   ├── eventService.ts     # Event replay
│   ├── interactionService.ts # UIP requests/responses
│   ├── contextBuilder.ts   # Agent context building
│   ├── projector.ts        # Projection runner
│   └── revision.ts         # Content revision calculation
│
├── infra/                   # Infrastructure Layer
│   ├── jsonlEventStore.ts  # JSONL EventStore implementation
│   ├── jsonlConversationStore.ts  # JSONL ConversationStore implementation
│   ├── jsonlAuditLog.ts    # JSONL AuditLog implementation
│   ├── toolRegistry.ts     # DefaultToolRegistry implementation
│   ├── toolExecutor.ts     # DefaultToolExecutor implementation
│   ├── fakeLLMClient.ts    # Mock LLM implementation
│   ├── openaiLLMClient.ts  # OpenAI LLM implementation
│   └── tools/              # Built-in tools
│       ├── readFile.ts
│       ├── editFile.ts
│       ├── listFiles.ts
│       └── runCommand.ts
│
├── agents/                  # Agent Layer
│   ├── agent.ts            # Agent interface + AgentOutput/AgentContext
│   ├── runtimeManager.ts   # RuntimeManager (event routing + lifecycle)
│   ├── runtime.ts          # AgentRuntime (task-scoped executor)
│   ├── conversationManager.ts # Conversation history management
│   ├── outputHandler.ts    # Agent output → side-effects
│   ├── displayBuilder.ts   # TUI display message builder
│   └── defaultAgent.ts     # DefaultCoAuthorAgent
│
├── cli/                     # CLI Interface Layer
│   ├── run.ts              # CLI command parsing
│   └── io.ts               # IO abstraction
│
├── tui/                     # TUI Interface Layer
│   ├── main.tsx            # Ink TUI
│   └── run.ts
│
├── config/
│   └── appConfig.ts        # Configuration loading
│
├── patch/
│   └── applyUnifiedPatch.ts # Unified diff application tool
│
└── app/
    └── createApp.ts        # App factory (Dependency Injection)
```

---

## 7. Dependency Rules

Follows the **Dependency Inversion Principle**:

```
Interfaces → Application → Domain ← Infrastructure
                              ↑
                           Agents
```

- **Domain** does not depend on any external modules; it only defines interfaces (Ports).
- **Application** depends on Domain and uses Infrastructure through Ports.
- **Infrastructure** implements the Ports defined in Domain.
- **Agents** also only depend on Domain Ports.
- **Interfaces** depend on Application and do not directly call Domain/Infrastructure.

---

## 8. Technology Stack

| Layer | Technology |
|----|------|
| Language | TypeScript |
| Runtime | Node.js |
| Persistence | JSONL (Sync append) |
| CLI | yargs |
| TUI | Ink (React-based) |
| Validation | Zod |
| LLM | OpenAI SDK / Anthropic SDK |
| Reactive | RxJS |
| Testing | Vitest |
| Formatting | Prettier |
