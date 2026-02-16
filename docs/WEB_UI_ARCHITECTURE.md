# Web UI Architecture

## Overview

The Web UI is a React + Vite SPA under `web/` and is served by the Seed server in production mode.

Core stack:
- React + React Router
- Zustand stores
- typed HTTP client (`services/api.ts`)
- realtime WebSocket client (`services/ws.ts`)
- lightweight in-app event bus for decoupled store updates

## Routing and Layout

Root app routes:
- `/` dashboard
- `/tasks/:taskId` task detail
- `/activity`
- `/settings`

Routes are lazy-loaded and wrapped in per-route error boundaries.

## State and Event Topology

Connection model:
- `connectionStore` owns WS lifecycle and connection status.
- WS messages are published to `eventBus` as:
  - `domain-event`
  - `ui-event`
- feature stores subscribe independently, avoiding direct cross-store imports.

This keeps store modules decoupled and testable.

## HTTP API Usage

`services/api.ts` calls backend endpoints:
- tasks CRUD-like operations
- interaction fetch/respond
- events, audit, runtime settings
- conversation retrieval
- file read

Auth token is read from `sessionStorage` (`seed-token`) and sent as bearer header when present.

## WebSocket Usage

`WsService`:
- connects to `/ws?token=...`,
- auto-reconnects with exponential backoff,
- subscribes to channels (`events`, `ui`),
- performs gap-fill via `lastEventId`,
- persists `lastEventId` in session storage.

Realtime UI therefore remains consistent across brief disconnects.

## Build and Serving

Server static root selection:
- prefer local `web/dist` when available,
- fallback to packaged `node_modules/.seed-web`.

SPA fallback serves `index.html` for non-API and non-WS routes.

## Relationship to TUI

Web UI and TUI share the same backend app/service contracts.

In client mode, both rely on remote adapters but preserve same high-level interaction model (tasks, events, UIP responses, runtime controls).
