# CoAuthor Milestones

> Version: V0.1  
> Last Updated: 2026-02-03  
> Status: Planning Document (Mutable)

---

## 2026-02-03 Direction Reset (Important)

- Plan/Patch are no longer used as the current collaboration protocol or domain event baseline.
- The current direction focuses on Task closed-loop + UIP (Universal Interaction Protocol) + Tool Use Audit (AuditLog).
- Content related to Plan/Patch in old milestones is for historical reference only and should not be a mandatory step for subsequent milestones.

## Overview

```
V0 = M0 + M1 + M2 + M3 + M4
V1 = V0 + TODO Async Pool + Background Scheduler + Overleaf Plugin Interface
```

### Milestone Dependency Graph

```
M0 ────→ M1 ────→ M2
          │
          └────→ M3
                  │
                  └────→ M4
```

---

## M0: Billboard Foundation Closed-Loop ✅ Completed

> **Goal**: Core Event Sourcing and CLI scaffolding, runnable without LLM.

> Note: This milestone was accepted according to the old baseline on 2026-02-02, where Patch-related items are for historical reference.

### Acceptance Criteria

- [x] EventStore interface definition (Port)
- [x] JsonlEventStore implementation
- [x] Basic Projection (TasksProjection)
- [x] Projector incremental update mechanism
- [x] CLI basic commands: task create/list (patch propose/accept are historical baseline)
- [x] File modification capability verification (historical baseline verified via unified diff pipeline)
- [x] Log replay

### Implemented Directory Structure

```
src/
├── domain/
│   ├── actor.ts           # Actor, ActorKind, ActorCapability ✅
│   ├── task.ts            # Task type definitions ✅
│   ├── artifact.ts        # Artifact type definitions ✅
│   ├── events.ts          # Complete Event schema (including authorActorId) ✅
│   ├── index.ts
│   └── ports/
│       ├── eventStore.ts  # EventStore interface ✅
│       ├── auditLog.ts    # AuditLog interface ✅
│       ├── conversationStore.ts # ConversationStore interface ✅
│       ├── llmClient.ts   # LLMClient interface ✅
│       └── tool.ts        # Tool/Registry/Executor interface ✅
├── application/
│   ├── taskService.ts     # Task use case encapsulation ✅
│   ├── eventService.ts    # Event replay service ✅
│   ├── interactionService.ts # UIP service ✅
│   ├── contextBuilder.ts  # Context building ✅
│   ├── projector.ts       # Projection runner ✅
│   └── revision.ts        # Content revision helper ✅
├── infra/
│   ├── jsonlEventStore.ts # JSONL implementation ✅
│   ├── jsonlAuditLog.ts   # AuditLog JSONL implementation ✅
│   ├── jsonlConversationStore.ts # ConversationStore JSONL implementation ✅
│   ├── toolRegistry.ts    # ToolRegistry implementation ✅
│   ├── toolExecutor.ts    # ToolExecutor implementation ✅
│   ├── fakeLLMClient.ts   # Fake LLM ✅
│   ├── openaiLLMClient.ts # OpenAI LLM ✅
│   └── tools/             # Built-in tools ✅
│       ├── readFile.ts
│       ├── editFile.ts
│       ├── listFiles.ts
│       └── runCommand.ts
├── cli/
│   ├── run.ts             # CLI entry ✅
│   └── io.ts              # I/O tools ✅
├── tui/
│   ├── main.tsx           # TUI components (optional) ✅
│   └── run.ts
├── agents/
│   ├── agent.ts           # Agent interface ✅
│   ├── runtime.ts         # AgentRuntime ✅
│   └── defaultAgent.ts    # Default Agent ✅
└── patch/
    └── applyUnifiedPatch.ts # Patch engine ✅
```

### Architecture Completion Beyond Expectations

The content actually completed in M0 exceeded the original plan, including:
- ✅ Complete Domain layer (Actor, Task, Artifact, Events)
- ✅ Complete Application layer (Services + Projections)
- ✅ All events already include `authorActorId`
- ✅ Full implementation of Hexagonal Architecture (Port-Adapter)

### Components to be Completed in M1

| Component | Status | Description |
|------|------|------|
| LLMClient Interface | ❌ Missing | M1 Core Goal |
| AgentRuntime | ❌ Missing | M1 Core Goal |
| ContextBuilder | ❌ Missing | M1 Core Goal |
| Projection Checkpoint | ⚠️ To be optimized | TD-3 Technical Debt |

---

## M1: LLM Integration Readiness ✅ Completed

> **Goal**: Complete the system foundation (LLM abstraction, Agent runtime, incremental projection) to prepare for subsequent MVP execution.
> **Note**: Historical implementation of this milestone may include Plan/Patch related designs, but as of 2026-02-03, they are no longer current protocol requirements. See [M1_STATUS.md](M1_STATUS.md) for details.

---

## M2: MVP: Task Loop + UIP + Tool Audit + General Agent

> **Goal**: User request (one sentence) → Agent starts execution (TaskStarted) → Loop until completion; unify decisions/information requests/high-risk actions through UIP; file modifications and command executions unify through Tool Use and are written to AuditLog.

### Acceptance Criteria

- [ ] **Domain Event Convergence**
  - DomainEvent only includes Task lifecycle + UIP (no Plan/Patch events)
- [ ] **Tool Audit Chain**
  - ToolRegistry/ToolExecutor + Interceptor
  - AuditLog appends ToolCallRequested/ToolCallCompleted
- [ ] **High-risk Action Confirmation**
  - Trigger `UserInteractionRequested(purpose=confirm_risky_action)` before writing files/executing commands
  - Tools allowed to execute only after user confirmation
- [ ] **General Agent Skeleton**
  - `start → loop until done`
  - Information gaps/decisions unify through UIP
- [ ] **Interaction Rendering and Input**
  - CLI/TUI can render UIP requests and submit UIP responses
- [ ] **Task Session and Control**
  - Support `pause/resume` to pause and restore tasks
  - Support `refine/continue` to add instructions after task completion (Task Session)

### Acceptance Testing

```bash
# User initiates request
npm run dev -- task create "Make this section sound more academic" --file chapters/01_intro.tex --lines 10-20
# Agent starts execution (TaskStarted)
# If information is missing or a decision is needed: Agent initiates UIP (request_info/choose_strategy), user responds via UIP (UserInteractionResponded)
# If file writing or command execution is needed: Agent initiates UIP high-risk confirmation (confirm_risky_action, can show diff)
# Tool Use executes after user confirmation and is written to AuditLog
# Task completed (TaskCompleted)
```

---

## M3: Tool Safety and Conflict Resolution (JIT)

> **Goal**: If a user manually modifies a file while the Agent is working, the system will not blindly overwrite it; conflicts are resolved via tool failure + UIP guidance rather than Patch events.

### Design Decisions

- ✅ **Tool-side JIT Validation**: File-writing Tool Use supports expectedRevision/atomic write strategy; fails directly and logs to AuditLog if it doesn't match.
- ✅ **Interaction Guidance**: Agent asks the user for the next step via UIP (retry/abandon/change strategy/terminate task).
- ❌ **No Hard Dependency on FileWatcher**: Background monitoring is not used as a source of truth for consistency (optional enhancement only for "early stop/token saving").

---

## M4: OUTLINE / BRIEF / STYLE Context Injection

> **Goal**: Significantly improve effectiveness in changing writing style and chapter goals, reducing repetition.

### Acceptance Criteria

- [ ] **OUTLINE.md Parsing**
  - Parse Markdown heading structure
  - Map to .tex file locations

- [ ] **ContextBuilder Enhancement**
  - Always inject OUTLINE.md
  - Inject BRIEF.md if it exists (what the article does, contributions, readers)
  - Inject STYLE.md if it exists (tone, glossary, forbidden words)

- [ ] **Missing Prompts**
  - Prompt user to create BRIEF.md if it doesn't exist
  - Prompt user to create STYLE.md if it doesn't exist

### Acceptance Testing

```bash
# Create OUTLINE.md
# Create task
npm run dev -- task create "Expand Chapter 2"
# Agent's context includes OUTLINE.md
# Generated content is consistent with the outline
```

---

## V1 Reserved (Explicitly Postponed)

The following features are explicitly postponed to V1:

### TODO Comment Async Pool

- `/todo add <file:range> <comment>` creates a background task
- Scheduler executes automatically when idle
- TODO list view
- Batch confirm/reject interaction requests (UIP)

### Background Scheduler

- Background task queue
- Idle execution strategy
- Concurrency control

### Overleaf Plugin Interface

- WebSocket/SSE event broadcasting
- Remote Adapter protocol
- Selection → artifactRefs conversion

### Asset System Finalization

- Mandatory validation for chart metadata
- Code asset association
- VLM chart descriptions (but no data guessing)

### Multi-Agent Collaboration

- ReviewerAgent
- InterviewerAgent
- RelatedWorkAgent

---

## Time Estimation

| Milestone | Estimated Man-hours | Prerequisites |
|--------|----------|----------|
| M0 | ✅ Completed | - |
| M1 | 2-3 days | M0 |
| M2 | 3-5 days | M1 |
| M3 | 2-3 days | M1 |
| M4 | 1-2 days | M2 |

---

## Risks and Mitigation

| Risk | Impact | Mitigation Measures |
|------|------|----------|
| LLM API Instability | M2 progress blocked | Develop using mock LLMClient |
| Tool Write Conflicts/Concurrent Modifications | M3 implementation difficult | Tool-side validation + UIP confirmation/retry/termination strategy |
| Context Too Long | Cost/Quality issues | Segmentation strategy, only inject relevant fragments |
| Event Replay Performance | Slows down with many events | Projection caching + incremental updates |

---

## Appendix (Deprecated): Legacy M1 Task Breakdown

> **Deprecated**: This appendix is a task breakdown under the old baseline as of 2026-02-02, containing obsolete protocol concepts such as Plan/Patch; as of 2026-02-03, it is no longer the execution baseline for milestones and is for historical reference only.

### 1. Define LLMClient Port (1-2h)

```typescript
// Create src/domain/ports/llmClient.ts
export type LLMProfile = 'fast' | 'writer' | 'reasoning'

export interface LLMClient {
  // Synchronous generation (wait for full response)
  generate(
    context: string,
    profile: LLMProfile,
    opts?: GenerateOptions
  ): Promise<string>
  
  // Streaming generation (return token by token)
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

### 2. Implement Anthropic LLM Adapter (2-3h)

```typescript
// Create src/infra/anthropicLLMClient.ts
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
  
  // TODO: Implement stream()
}
```

### 3. Implement ContextBuilder Service (2-3h)

```typescript
// Create src/application/contextBuilder.ts
import { readFileSync } from 'node:fs'
import type { ArtifactRef } from '../domain/index.js'

export class ContextBuilder {
  constructor(private baseDir: string) {}
  
  // Build task context
  buildTaskContext(task: TaskView): string {
    const parts: string[] = []
    
    // 1. Task description
    parts.push(`# Task: ${task.title}\n${task.intent}\n`)
    
    // 2. Read relevant file snippets
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
    
    // TODO: Support range cropping
    return content
  }
}
```

### 4. Implement Basic AgentRuntime (3-4h)

```typescript
// Create src/agents/runtime.ts
import type { EventStore, LLMClient } from '../domain/ports/index.js'
import type { TaskView } from '../application/taskService.js'

export class AgentRuntime {
  private isRunning = false
  
  constructor(
    private store: EventStore,
    private llm: LLMClient,
    private agentId: string
  ) {}
  
  // Start Agent
  start(): void {
    this.isRunning = true
    console.log(`[Agent ${this.agentId}] Started`)
    // M1: Auto-subscription not implemented, wait for M2
  }
  
  // Stop Agent
  stop(): void {
    this.isRunning = false
    console.log(`[Agent ${this.agentId}] Stopped`)
  }
  
  // Manually handle task (for M1 testing)
  async handleTask(task: TaskView): Promise<void> {
    console.log(`[Agent] Handling task ${task.taskId}`)
    
    // 1. Build context
    const contextBuilder = new ContextBuilder(process.cwd())
    const context = contextBuilder.buildTaskContext(task)
    
    // 2. Call LLM to generate plan
    const plan = await this.llm.generate(
      `${context}\n\nGenerate an execution plan for this task.`,
      'fast'
    )
    
    console.log(`[Agent] Generated plan:\n${plan}`)
    
    // M1: Print only, no events written (M2 implements full workflow)
  }
}
```

### 5. Projection Checkpoint Optimization (2-3h)

```typescript
// Modify src/application/projector.ts
// 1. Persist checkpoint to .coauthor/projections.jsonl
// 2. Restore from checkpoint, only process new events
// 3. Save checkpoint periodically (every 100 events)

export async function projectWithCheckpoint<S>(
  store: EventStore,
  projectionName: string,
  initialState: S,
  reducer: (state: S, event: StoredEvent) => S
): Promise<S> {
  // 1. Read checkpoint
  const checkpoint = await store.loadProjection(projectionName)
  let state = checkpoint?.stateJson ? JSON.parse(checkpoint.stateJson) : initialState
  const fromEventId = checkpoint?.cursorEventId ?? 0
  
  // 2. Process new events only
  const events = await store.readAll({ fromId: fromEventId + 1 })
  for (const evt of events) {
    state = reducer(state, evt)
  }
  
  // 3. Save new checkpoint
  await store.saveProjection({
    name: projectionName,
    cursorEventId: events[events.length - 1]?.id ?? fromEventId,
    stateJson: JSON.stringify(state)
  })
  
  return state
}
```

### 6. New Event Types (1h)

```typescript
// Modify src/domain/events.ts
// Add AgentPlanPosted event
export const AgentPlanPostedPayloadSchema = z.object({
  authorActorId: z.string().min(1),
  taskId: z.string().min(1),
  planId: z.string().min(1),
  planText: z.string().min(1),
  estimatedSteps: z.number().int().optional()
})

// Add UserFeedbackPosted event
export const UserFeedbackPostedPayloadSchema = z.object({
  authorActorId: z.string().min(1),
  taskId: z.string().min(1),
  targetId: z.string().min(1),  // planId or proposalId
  targetType: z.enum(['plan', 'patch']),
  feedbackText: z.string().min(1),
  sentiment: z.enum(['accept', 'reject', 'request_changes']).optional()
})

// Update DomainEventSchema union
```

### 7. Update Tests (2-3h)

```typescript
// Add tests/llmClient.test.ts (using mock)
// Add tests/contextBuilder.test.ts
// Add tests/agentRuntime.test.ts
// Update tests/projector.test.ts (test checkpoint)
```

---

### M1 Acceptance Testing

```bash
# 1. Start Agent Runtime (manual mode)
npm run dev -- agent start

# 2. Create task
npm run dev -- task create "Improve introduction" --file chapters/01_intro.tex

# 3. Manually trigger Agent processing
npm run dev -- agent handle <taskId>
# Expected: Agent calls LLM, outputs plan (no events written yet)

# 4. Verify projection checkpoint
npm run dev -- task list
# Expected: Uses cached projection, performance improved

# 5. Verify event log
npm run dev -- log replay
# Expected: No new events (M1 only tests infrastructure)
```
