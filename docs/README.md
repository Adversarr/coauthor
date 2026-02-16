# Seed Documentation (Current)

This directory contains the **current** documentation for the live codebase.

The old documents are preserved in `docs/legacy/` for historical context.

## Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, layers, runtime flow, local/remote mode
- [DOMAIN.md](./DOMAIN.md) — domain model, task lifecycle, UIP events, projections
- [LLM_CONFIGURATION.md](./LLM_CONFIGURATION.md) — providers, profiles, env vars, schema strategies
- [SECURITY.md](./SECURITY.md) — trust boundaries, auth, path safety, network and API hardening
- [TOOL_SCHEMA.md](./TOOL_SCHEMA.md) — tool contracts, risk model, execution/audit behavior
- [WEB_UI_ARCHITECTURE.md](./WEB_UI_ARCHITECTURE.md) — Web SPA architecture and realtime data flow
- [OPERATIONS.md](./OPERATIONS.md) — CLI/server operations, master discovery, persistence layout

## Notes

- Current source-of-truth is code under `src/` and `web/src/`.
- `docs/legacy/` documents are intentionally not updated and may diverge from current behavior.
- Legacy documents may still reference historical `coauthor` naming and STEM-paper-focused framing.
