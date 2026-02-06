# coauthor

M0: Billboard basic closed-loop (runs even without LLM).

## Quick Start (M0 closed-loop)

```bash
# 1) Create task (outputs taskId)
npm run dev -- task create "demo"

# 2) Submit patch proposal (reads unified diff from stdin)
npm run dev -- patch propose <taskId> demo/doc.tex < demo/patches/doc-hello-to-HELLO.diff

# 3) Apply patch (actually modifies demo/doc.tex)
npm run dev -- patch accept <taskId> latest

# 4) Replay event stream (confirm what happened)
npm run dev -- log replay <taskId>
```

You can also start the TUI (interactive interface):

```bash
npm run dev
```

Type `/help` in the TUI to see commands; `/log replay [taskId]` prints events to the terminal and shows the number of replayed events in the UI.

## Development

```bash
npm i
npm run dev
```

## Build and Test

```bash
npm run build
npm test
```

## LLM Debugging

```bash
npm run dev -- llm test --mode tool_use
npm run dev -- llm test --mode stream_tool_use
```

To output structured telemetry events to stdout:

```bash
COAUTHOR_TELEMETRY_SINK=console npm run dev -- llm test --mode tool_use
```

See [llm-context.md](file:///Users/yangjerry/Repo/coauthor/docs/llm-context.md) for context persistence and recovery semantics.

See [tool-schema.md](file:///Users/yangjerry/Repo/coauthor/docs/tool-schema.md) for tool schema adaptation and rollback toggles.
