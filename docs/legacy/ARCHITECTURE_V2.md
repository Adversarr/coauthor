# CoAuthor Architecture V2 (Implementation-Centric)

This document describes the **current implementation architecture** (how the code actually couples today), with a focus on:

- Backend ↔ frontend coupling (HTTP + WebSocket)
- `httpServer` / Web UI / TUI design
- The “bus” design (domain events vs UI events), implemented with RxJS but exposed as domain ports

For the normative design principles, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Process Model: Master + Clients

CoAuthor runs as **a single localhost-only master process** that owns persistence, projections, and agent execution; other invocations attach as clients.

- **Master**
  - Runs HTTP API + WebSocket server on one port: [server.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/server.ts)
  - Owns `JsonlEventStore` (event log + projection checkpoints), `JsonlAuditLog`, `JsonlConversationStore`
  - Runs `RuntimeManager` which subscribes to the domain event stream and orchestrates per-task agent runtimes
  - Optionally serves a built Web UI SPA (static + SPA fallback)
- **Clients**
  - CLI/TUI can run in “remote mode”: they build an `App` backed by remote adapters and use HTTP/WS to talk to the master: [createRemoteApp.ts](file:///Users/yangjerry/Repo/coauthor/src/app/createRemoteApp.ts)
  - Web UI talks to the master via same-origin HTTP + WS and keeps its own UI state

This “single-writer master” is intentional: `JsonlEventStore` relies on in-process locking; multi-process writes would corrupt ordering/atomicity.

---

## 2. Three Persistence Streams (and Why)

CoAuthor uses three distinct persistence channels with different semantics:

1. **Domain EventStore**: collaboration history and task lifecycle  
   - Stored in `.coauthor/events.jsonl`  
   - Event schemas: [events.ts](file:///Users/yangjerry/Repo/coauthor/src/domain/events.ts)  
   - Port: [eventStore.ts](file:///Users/yangjerry/Repo/coauthor/src/domain/ports/eventStore.ts)

2. **Tool AuditLog**: tool call trace (file edits, commands, etc.)  
   - Stored in `.coauthor/audit.jsonl`  
   - Port: [auditLog.ts](file:///Users/yangjerry/Repo/coauthor/src/domain/ports/auditLog.ts)

3. **ConversationStore**: LLM conversation context persistence  
   - Stored in `.coauthor/conversations.jsonl`  
   - Port: [conversationStore.ts](file:///Users/yangjerry/Repo/coauthor/src/domain/ports/conversationStore.ts)

Key invariant: **domain events are not polluted by execution details**; execution is audited separately.

---

## 3. Two “Buses”: Domain Events vs UI Events

There are two realtime streams, both exposed to the rest of the system through **domain ports** as `Subscribable<T>`, so the domain does not depend on RxJS.

### 3.1 Domain Event Stream (EventStore.events$)

- What it is: append-only `StoredEvent` stream reflecting domain events
- Producer: `JsonlEventStore.append()` emits after persistence: [jsonlEventStore.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/jsonlEventStore.ts)
- Consumers:
  - Agent orchestration: `RuntimeManager.start()` subscribes once and routes by task: [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts)
  - WS fanout: broadcasts to remote clients: [wsServer.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/ws/wsServer.ts)
  - TUI: used as a “refresh trigger” to re-run projections: [main.tsx](file:///Users/yangjerry/Repo/coauthor/src/tui/main.tsx)

This stream is the **system’s authoritative collaboration log**.

### 3.2 UI Event Stream (UiBus.events$)

- What it is: ephemeral UX events used for rendering/streaming output, not collaboration history
- Producer(s):
  - Agent output handler emits `agent_output`, `stream_delta`, `stream_end`: [outputHandler.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/outputHandler.ts)
  - AuditLog entries are forwarded into UiBus as `audit_entry`: [createApp.ts](file:///Users/yangjerry/Repo/coauthor/src/app/createApp.ts)
- Consumers:
  - TUI renders it live: [main.tsx](file:///Users/yangjerry/Repo/coauthor/src/tui/main.tsx)
  - WS fanout for Web UI + remote clients: [wsServer.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/ws/wsServer.ts)

This stream is the **system’s realtime UX channel**.

### 3.3 Implementation Detail: RxJS Behind a Port

Domain ports define a tiny subscription interface: [subscribable.ts](file:///Users/yangjerry/Repo/coauthor/src/domain/ports/subscribable.ts). Infra chooses RxJS `Subject` to implement it:

- `SubjectUiBus`: [subjectUiBus.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/subjectUiBus.ts)
- `JsonlEventStore` internal subject: [jsonlEventStore.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/jsonlEventStore.ts)
- `JsonlAuditLog` internal subject: [jsonlAuditLog.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/jsonlAuditLog.ts)
- Remote WS client subjects: [wsClient.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/remote/wsClient.ts)

Result: consumers are written against a stable abstraction; RxJS remains an infra choice.

---

## 4. Composition Roots: Local App vs Remote App

### 4.1 Local (Master) App

`createApp()` wires the entire system together: [createApp.ts](file:///Users/yangjerry/Repo/coauthor/src/app/createApp.ts)

Key wiring choices:

- Infra adapters: `JsonlEventStore`, `FsArtifactStore`, `JsonlAuditLog`, `JsonlConversationStore`, `DefaultToolExecutor`, `UiBus`
- Application services: `TaskService`, `EventService`, `InteractionService`, `AuditService`, `ContextBuilder`
- Agents: `RuntimeManager` + registered agents (`DefaultCoAuthorAgent`, `SearchAgent`, `MinimalAgent`)
- Cross-cutting: audit entries are forwarded into UiBus for live rendering

### 4.2 Remote (Client) App

`createRemoteApp()` returns an `App` with the **same shape** so the TUI can run unchanged, but most services are replaced by HTTP/WS delegating adapters: [createRemoteApp.ts](file:///Users/yangjerry/Repo/coauthor/src/app/createRemoteApp.ts)

- Domain stream (`EventStore.events$`) becomes “WS messages turned back into a local `Subscribable`”
- UI stream (`UiBus.events$`) likewise
- RuntimeManager becomes a stub; profile/streaming toggles delegate to HTTP
- Several master-only capabilities become explicit “not available in client mode” stubs

This is a practical boundary: the master is the only writer/executor; clients are viewers/command issuers.

---

## 5. Transport: HTTP for Commands/Queries, WS for Streams

### 5.1 HTTP Server (Hono)

The HTTP API is a thin adapter that calls application services directly: [httpServer.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/http/httpServer.ts)

- Auth: `Authorization: Bearer <token>` (also accepts `?token=` for compatibility)
- Validation: Zod on all POST bodies

Routes (authoritative in code):

- Health: `GET /api/health`
- Tasks:
  - `GET /api/tasks` → `{ tasks }`
  - `GET /api/tasks/:id` → `TaskView`
  - `POST /api/tasks` → `{ taskId }`
  - `POST /api/tasks/:id/{cancel|pause|resume}` → `{ ok: true }`
  - `POST /api/tasks/:id/instruction` → `{ ok: true }`
- Events:
  - `GET /api/events?after=<id>` → `{ events }`
  - `GET /api/events/:id` → `StoredEvent`
  - `GET /api/tasks/:id/events` → `{ events }`
- UIP:
  - `GET /api/tasks/:taskId/interaction/pending` → `{ pending }`
  - `POST /api/tasks/:taskId/interaction/:interactionId/respond` → `{ ok: true }`
- Audit:
  - `GET /api/audit?taskId=&limit=` → `{ entries }`
- Runtime:
  - `GET /api/runtime` → `{ defaultAgentId, streamingEnabled, agents:[{id,displayName,description}] }`
  - `POST /api/runtime/profile` → `{ ok: true }`
  - `POST /api/runtime/streaming` → `{ ok: true }`
- Files (via `ArtifactStore`):
  - `GET /api/files?path=` → `{ path, content }`
  - `POST /api/files` → `{ ok: true }`

### 5.2 WS Server (ws)

WebSocket provides realtime fanout + gap-fill replay: [wsServer.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/ws/wsServer.ts)

- Path: `/ws`
- Auth: `?token=<token>`
- Subscriptions: client subscribes to channels `events` and/or `ui`
- Gap-fill: client sends `lastEventId`, server replays missed events via `EventService.getEventsAfter()`

### 5.3 One Port, Two Protocols, Plus Static Hosting

`CoAuthorServer` binds a single port and bridges requests to Hono’s `fetch()` handler, specifically to also support `upgrade` for WebSocket: [server.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/server.ts)

If a Web UI build exists, the server also:

- Serves static files from `web/dist` (dev) or `node_modules/.coauthor-web` (installed build)
- Applies SPA fallback for non-`/api` and non-`/ws` routes

---

## 6. Frontend Coupling (Web UI)

The Web UI lives in `web/` (Vite + React) and couples to the backend via:

- HTTP: `web/src/services/api.ts`
- WS: `web/src/services/ws.ts`
- State: Zustand stores in `web/src/stores/`

### 6.1 Current Web State Model

- The task list is not derived from `/api/tasks/:id`; it is:
  - initialized once via `/api/tasks` (Dashboard page), and then
  - incrementally updated by applying WS domain events in the store reducer
- Agent output (including streaming deltas) is rendered from WS UI events

Key modules:

- HTTP client: [api.ts](file:///Users/yangjerry/Repo/coauthor/web/src/services/api.ts)
- WS client: [ws.ts](file:///Users/yangjerry/Repo/coauthor/web/src/services/ws.ts)
- Task store: [taskStore.ts](file:///Users/yangjerry/Repo/coauthor/web/src/stores/taskStore.ts)
- Stream store: [streamStore.ts](file:///Users/yangjerry/Repo/coauthor/web/src/stores/streamStore.ts)
- Wiring: [connectionStore.ts](file:///Users/yangjerry/Repo/coauthor/web/src/stores/connectionStore.ts)

### 6.2 Known Contract Mismatches (HTTP)

Several frontend calls assume different response shapes than the backend currently returns.

Backend (authoritative) wraps responses such as `{ events }`, `{ entries }`, `{ pending }`, etc.: [httpServer.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/http/httpServer.ts)

Frontend `api.ts` currently assumes unwrapped bodies for multiple endpoints. This will cause runtime failures unless a proxy/adapter is compensating.

Concrete mismatches to align (examples):

- `/api/events` returns `{ events }` but frontend expects `StoredEvent[]`
- `/api/audit` returns `{ entries }` but frontend expects an array and uses `after=` which backend ignores
- `/api/files` returns `{ path, content }` but frontend expects `{ content, lines }`
- `/api/tasks/:taskId/interaction/pending` returns `{ pending }` but frontend expects `PendingInteraction | null`

Recommended direction:

- Make the contract consistent (either always wrap, or always return the domain object directly).
- Centralize types (shared package or generated OpenAPI) so frontend and backend cannot drift silently.

### 6.3 Known UX/Navigation Pitfall

`/tasks/:taskId` does not fetch task-by-id on load; it only consults the already-loaded task list. If the user deep-links/refreshes a task URL before visiting the dashboard, it may render “Task not found” even though `GET /api/tasks/:id` exists.

---

## 7. Frontend Coupling (TUI)

The Ink TUI is a separate adapter that:

- Uses `EventStore.events$` as a “tick” to `refresh()` projections
- Uses `UiBus.events$` for live output and audit rendering

Entry point: [main.tsx](file:///Users/yangjerry/Repo/coauthor/src/tui/main.tsx)

This design makes the TUI “projection-first”: it trusts the application services to build current read models, rather than maintaining its own incremental projection reducer.

---

## 8. Agent Runtime + Buses: Where Coupling Actually Happens

The most important coupling in the system is:

- **Domain events drive execution** (RuntimeManager subscribes to `events$`)
- **UI events render execution** (OutputHandler emits to UiBus; Audit is forwarded to UiBus)

Key files:

- Runtime orchestration: [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts)
- Output/UI emission: [outputHandler.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/outputHandler.ts)
- Tool execution + audit: [toolExecutor.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/toolExecutor.ts), [jsonlAuditLog.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/jsonlAuditLog.ts)
- WS fanout bridging both buses: [wsServer.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/ws/wsServer.ts)

This split lets us:

- keep domain history clean/replayable, while
- still supporting rich streaming UX, and
- broadcast both to remote consumers.

---

## 9. Architectural Debt / Next Alignments (Explicit)

This is an implementation-centric map; it also exposes gaps worth prioritizing:

1. **HTTP contract drift** between `httpServer.ts` and `web/src/services/api.ts`
2. **Web task projection drift**: frontend’s incremental reducer does not implement all domain events the backend projection handles
3. **Deep-link/refresh behavior**: Web UI should ensure tasks are loaded when entering a task route

These are not theoretical: they are direct consequences of adapter-level coupling without shared contracts.

