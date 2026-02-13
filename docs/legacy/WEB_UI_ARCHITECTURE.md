# CoAuthor Web UI Architecture

**Status:** Draft
**Date:** 2025-02-10
**Author:** Claude

---

## 1. Executive Summary

This document describes the architecture for adding a **Web UI** to CoAuthor as an advanced interface alongside the existing Terminal UI (TUI). The Web UI provides a browser-based LaTeX editing environment with real-time collaboration capabilities.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Framework** | Vite + React (SPA) | Lighter than Next.js; no Server Component complexity |
| **Editor** | Monaco Editor only | Source-mode LaTeX editing; no rich text needed |
| **Real-time** | WebSocket over RxJS | Efficient event streaming; shared with TUI |
| **Architecture** | Hexagonal / Ports-Adapters | Consistent with existing codebase |
| **Runtime** | Single Process | Mandatory: `JsonlEventStore` locking is in-process only |

---

## 2. Architecture Overview

### 2.1 Hexagonal Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      INTERFACE LAYER                           │
│  ┌─────────────┐    ┌─────────────────────────────────────┐  │
│  │   TUI       │    │           Web UI (Browser)          │  │
│  │  (Ink/React)│    │  ┌─────────┐  ┌─────────────────┐    │  │
│  └──────┬──────┘    │  │  React  │  │  Monaco Editor  │    │  │
│         │           │  │  + Vite  │  │  (LaTeX mode)  │    │  │
│         │           │  └────┬────┘  └─────────────────┘    │  │
│         │           └───────┼─────────────────────────────┘  │
└─────────┼───────────────────┼────────────────────────────────┘
          │                   │
          ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   APPLICATION LAYER                          │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │TaskService  │  │Interaction  │  │  ContextBuilder     │   │
│  │(Commands)   │  │Service      │  │  (LLM Context)      │   │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────┘   │
│         │                │                                   │
└─────────┼────────────────┼───────────────────────────────────┘
          │                │
          ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                     DOMAIN LAYER                             │
│                     (Pure, No Deps)                          │
│  ┌─────────────────────────────────────────────────────┐     │
│  │         EventStore (Port Interface)                   │     │
│  │              events$: RxJS Observable                 │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │     │
│  │  │TaskCreated  │  │TaskStarted  │  │TaskCompleted│  │     │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │     │
│  └─────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                   INFRASTRUCTURE LAYER                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │ JsonlEventStore │  │ WebSocket Server│  │    LLM Client  │ │
│  │  (.jsonl files) │  │  (ws library)   │  │  (Anthropic)   │ │
│  └─────────────────┘  └─────────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Component Responsibilities

| Component | Layer | Responsibility |
|-----------|-------|----------------|
| **TUI** | Interface | Terminal-based UI using Ink/React |
| **Web UI** | Interface | Browser-based UI using React/Vite |
| **WebSocket Server** | Infrastructure | Bridges HTTP/WebSocket to domain events |
| **EventStore** | Domain Port | Append-only event log with RxJS stream |
| **TaskService** | Application | Task command handlers (create, start, cancel) |

---

## 3. Key Design Decisions

### 3.1 WebSocket as Primary Sync Mechanism

**Rationale:**
- HTTP polling is inefficient for collaborative editing
- WebSocket provides bidirectional, low-latency communication
- Natural fit for RxJS Observable streams

**Flow:**
```
Browser ──WebSocket──► WebSocketServer ──subscribe──► EventStore.events$
   ▲                                                        │
   └──────────────────── broadcast ◄───────────────────────┘
```

### 3.2 Monaco Editor (Source-Only)

**Rationale:**
- LaTeX is code-like; rich text adds complexity without benefit
- Monaco provides VS Code-quality editing experience
- Extensible via custom LaTeX language support

**Features:**
- Syntax highlighting for LaTeX
- Error squiggles (from LaTeX compilation)
- Minimap for document overview
- Command palette for quick actions

### 3.3 Shared EventStore (Single Source of Truth)

**Rationale:**
- TUI and Web UI interact with the same `JsonlEventStore`
- No "sync" logic needed—both subscribe to the same RxJS stream
- Web UI merely adds a network transport layer (WebSocket)

### 3.4 Single Process Runtime

**Rationale:**
- `JsonlEventStore` relies on `AsyncMutex` for thread safety, which works only within a single process.
- Running the Web Server and TUI as separate processes would lead to race conditions and data corruption in `.jsonl` files.
- **Decision:** The Web Server must be initialized within the main application process (e.g., via `npm run dev` or `coauthor start`), sharing the same `EventStore` instance.

### 3.5 Optimistic Concurrency Control (OCC)

**Rationale:**
- To prevent "Check-Then-Act" race conditions (e.g., User A cancels while User B starts), all state-changing commands must employ OCC.
- **Mechanism:**
  - Commands accept an `expectedSeq` (sequence number).
  - `EventStore` or `TaskService` validates that the current stream sequence matches `expectedSeq` before appending.
  - UI handles rejection (e.g., "Task state has changed, please refresh") or auto-merges if safe.

---

## 4. Implementation Phases

### Phase 1: WebSocket Bridge (P1)

**Goal:** Establish real-time connection between browser and backend.

**Deliverables:**
- WebSocket server (`ws` library) in `src/infra/webSocketServer.ts`
- Protocol design: message types (`subscribe`, `event`, `command`)
- Authentication/authorization for WebSocket connections
- Reconnection logic on client side

**Verification:**
```bash
# Terminal 1
npm run dev

# Terminal 2 (test WebSocket)
wscat -c ws://localhost:3001/ws
> {"type":"subscribe","streamId":"task-123"}
< {"type":"event","data":{...}}
```

### Phase 2: HTTP API (P2)

**Goal:** Provide RESTful endpoints for commands and queries.

**Deliverables:**
- Express (or native `http`) server in `src/infra/httpServer.ts`
- Endpoints:
  - `GET /api/tasks` — List all tasks
  - `GET /api/tasks/:id` — Get task by ID
  - `POST /api/tasks` — Create new task
  - `POST /api/tasks/:id/cancel` — Cancel task
  - `GET /api/tasks/:id/events` — Get task events (SSE fallback)
  - `GET /api/interactions/pending` — List pending UIPs
  - `POST /api/interactions/:id/respond` — Respond to UIP
  - `GET /api/audit` — Query audit log
- Request/response validation (Zod schemas)
- Error handling middleware

### Phase 3: React Shell (P3)

**Goal:** Setup browser application foundation.

**Deliverables:**
- Vite project in `src/web/` directory
- React + TypeScript configuration
- React Router setup (`/tasks`, `/tasks/:id`, `/interactions`)
- Zustand stores for client-side state:
  - `useTasksStore` — Task list and current task
  - `useEventsStore` — Event stream for current task
  - `useAuthStore` — User session (if needed)
- Layout components: `Sidebar`, `MainContent`, `StatusBar`
- Theme/styling (Tailwind or CSS Modules)

### Phase 4: Monaco Integration (P4)

**Goal:** Provide LaTeX editing environment.

**Deliverables:**
- Monaco Editor component (`@monaco-editor/react`)
- LaTeX language mode configuration:
  - Syntax highlighting rules
  - Bracket matching
  - Auto-indentation
  - Snippets (theorem, equation, figure environments)
- Integration with task artifacts:
  - Load `.tex` content from task's `ArtifactRef`
  - Auto-save on debounce (invoke `tool_edit_file` capability)
    - **Change:** Do NOT use `TaskInstructionAdded` for saves (avoids event bloat and agent triggers).
    - **Mechanism:** Call `ToolExecutor` directly or via `TaskService` helper. Records to `AuditLog`.
- Error markers from LaTeX compilation (parse `latexmk` output)
- Split view: Editor + PDF preview (if compiled PDF available)

### Phase 5: Real-time Sync (P5)

**Goal:** Connect UI to live event stream.

**Deliverables:**
- `useEventStream()` hook:
  - Opens WebSocket connection on mount
  - Subscribes to current task's event stream
  - **Sync Logic:** Sends `lastEventId` on subscribe/reconnect to fetch missed events (gap filling).
  - Buffers events, applies to Zustand store
  - Handles reconnection with exponential backoff
  - Graceful degradation to SSE or polling if WebSocket fails
- Optimistic updates for user actions:
  - User clicks "Cancel Task" → UI immediately shows "Cancelling..." → WebSocket confirms → UI updates to "Cancelled"
- Event visualization: Timeline view of all events for a task (expandable JSON)

### Phase 6: Polish (P6)

**Goal:** Production-ready experience.

**Deliverables:**
- Error boundaries: Catch React errors, show fallback UI
- Loading states: Skeleton screens, progress indicators
- Responsive design: Adapt layout for smaller screens (optional tablet support)
- Keyboard shortcuts: Vim bindings for Monaco, app-wide shortcuts (Cmd+K command palette)
- Accessibility: ARIA labels, keyboard navigation, screen reader support
- Performance: Virtualize long event lists, lazy load editor component, code splitting by route

---

## 5. Directory Structure

```
src/
├── web/                          # Web UI (Vite + React)
│   ├── src/
│   │   ├── components/         # React components
│   │   │   ├── Editor/         # Monaco wrapper
│   │   │   ├── TaskList/       # Task list view
│   │   │   ├── TaskDetail/     # Task detail view
│   │   │   ├── UIPPanel/       # User interaction panel
│   │   │   └── common/         # Shared UI components
│   │   ├── hooks/              # Custom React hooks
│   │   │   ├── useEventStream.ts
│   │   │   ├── useTasks.ts
│   │   │   └── useWebSocket.ts
│   │   ├── stores/             # Zustand stores
│   │   │   ├── tasksStore.ts
│   │   │   ├── eventsStore.ts
│   │   │   └── uiStore.ts
│   │   ├── services/           # API clients
│   │   │   ├── apiClient.ts    # HTTP API client
│   │   │   └── wsClient.ts     # WebSocket client
│   │   ├── types/              # TypeScript types
│   │   ├── utils/              # Utilities
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── routes.ts
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── infra/                        # Infrastructure adapters
│   ├── jsonlEventStore.ts
│   ├── webSocketServer.ts        # NEW: WebSocket server
│   └── httpServer.ts             # NEW: HTTP REST API
├── application/                  # Application services
│   └── ... (existing)
└── domain/                       # Domain layer
    └── ... (existing)
```

---

## 6. Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Build Tool** | Vite | Fast dev server, optimized builds |
| **UI Framework** | React 18 | Component-based UI |
| **Language** | TypeScript | Type safety |
| **Routing** | React Router v6 | Client-side navigation |
| **State Management** | Zustand | Lightweight state management |
| **Editor** | Monaco Editor | LaTeX source editing |
| **Styling** | Tailwind CSS | Utility-first CSS |
| **Icons** | Lucide React | Consistent iconography |
| **HTTP Client** | Native fetch | API communication |
| **WebSocket** | Native WebSocket | Real-time event streaming |

---

## 7. API Design

### 7.1 HTTP Endpoints

```
GET    /api/tasks              # List all tasks
GET    /api/tasks/:id          # Get task by ID
POST   /api/tasks              # Create new task
POST   /api/tasks/:id/cancel  # Cancel task
POST   /api/tasks/:id/pause    # Pause task
POST   /api/tasks/:id/resume   # Resume task

GET    /api/tasks/:id/events   # Get task events (SSE stream)

GET    /api/interactions/pending    # List pending UIPs
POST   /api/interactions/:id/respond # Respond to UIP

GET    /api/audit              # Query audit log
```

### 7.2 WebSocket Protocol

```typescript
// Client → Server
interface WSCommand {
  type: 'subscribe' | 'unsubscribe' | 'command';
  payload: {
    streamId?: string;      // For subscribe/unsubscribe
    command?: string;       // For command
    args?: Record<string, unknown>;
  };
  id: string;               // Request ID for correlation
}

// Server → Client
interface WSEvent {
  type: 'event' | 'error' | 'ack';
  payload: {
    streamId?: string;
    event?: DomainEvent;
    error?: string;
    commandId?: string;     // Correlates to WSCommand.id
  };
}
```

---

## 8. Data Flow

### 8.1 Task Creation Flow

```
┌─────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  User   │────►│  React UI   │────►│  HTTP POST   │────►│  TaskService │
│         │     │             │     │  /api/tasks  │     │             │
└─────────┘     └─────────────┘     └──────────────┘     └──────┬──────┘
                                                                │
                                                                ▼
┌─────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  TUI    │◄────│  EventStore │◄────│  events$     │◄────│  emit       │
│  (Ink)  │     │  (Jsonl)    │     │  (RxJS)      │     │  TaskCreated│
└─────────┘     └─────────────┘     └──────────────┘     └─────────────┘
     ▲
     │
┌─────────────┐
│  Web UI     │◄────┐
│  (Browser)  │     │ (via WebSocket)
└─────────────┘     │
                    │
              ┌─────┴─────┐
              │  WebSocket│
              │  Server   │
              └───────────┘
```

---

## 9. Extensibility Points

| Extension | Implementation |
|-----------|----------------|
| **New Editor** | Implement `EditorPort` interface; swap Monaco for CodeMirror |
| **Collaboration** | Add OT/CRDT layer on EventStore; broadcast cursor positions |
| **Mobile App** | React Native consuming same WebSocket API |
| **Plugin System** | Domain events are extensible; plugins subscribe to events$ |
| **VCS Integration** | New application service: `GitService`; emits `GitCommitEvent` |

---

## 10. Security Considerations

| Concern | Mitigation |
|---------|------------|
| **CORS** | Whitelist allowed origins for WebSocket |
| **Input Validation** | Zod schemas for all incoming data |
| **Rate Limiting** | Per-IP limits on HTTP endpoints |
| **Authentication** | JWT tokens for WebSocket auth (future) |
| **Process Isolation** | **CRITICAL:** Web Server and TUI MUST run in the same process to share `AsyncMutex`. |
| **Local Access** | Ensure Web UI only binds to `localhost` to prevent external network access to filesystem. |

---

## 11. Success Criteria

- [ ] Web UI launches from TUI command
- [ ] Both TUI and Web UI show synchronized task state
- [ ] Monaco editor loads with LaTeX syntax highlighting
- [ ] Task events appear in real-time without refresh
- [ ] UIP interactions work through Web UI
- [ ] All existing TUI functionality remains intact

---

## 12. Appendix: Glossary

| Term | Definition |
|------|------------|
| **TUI** | Terminal User Interface (existing Ink/React interface) |
| **UIP** | User Interaction Protocol (prompts requiring user response) |
| **OT** | Operational Transform (collaborative editing algorithm) |
| **CRDT** | Conflict-free Replicated Data Type (alternative to OT) |
| **SPA** | Single Page Application (client-side routing, no page reloads) |
| **SSE** | Server-Sent Events (unidirectional HTTP streaming) |

---

*End of Document*
