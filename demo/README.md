# Seed Demo - General Workspace Task

This demo shows Seed handling a general maintenance task (not paper-specific):

- discover files (`listFiles`),
- inspect context (`readFile`),
- propose a risky edit (`editFile`),
- wait for UIP confirmation,
- finalize with a task summary.

## Demo Assets

```text
demo/
├── README.md
├── fake-llm-config.ts        # Deterministic response sequence used for scripted demos/tests
├── brief.md                  # Project brief for context
├── outline.md                # Goal and execution outline
├── data/
│   └── sample.txt            # Primary file edited in this demo
└── paper/                    # Optional writing-domain sample assets
```

## Recommended Walkthrough (TUI)

1. Start Seed:

```bash
npm run dev
```

2. In TUI, create and run a task:

```text
/new Improve task clarity in demo/data/sample.txt
/continue Read the file, propose a single focused improvement, and apply only after confirmation.
```

3. Observe expected behavior:
- Safe reads execute directly.
- Risky edit triggers UIP with diff preview.
- After approval, task transitions to completion.

4. Verify the file change:

```bash
cat demo/data/sample.txt
```

## What This Verifies

- Tool loop execution with deterministic state transitions.
- UIP safety guard for risky operations.
- Event + audit separation in `.seed/`.
- End-to-end behavior for a non-writing workspace task.

## Optional: Scripted Fake Sequence

`demo/fake-llm-config.ts` contains a deterministic sequence for a scripted fake-LLM run. Use it in custom harness/tests where you inject `FakeLLMClient` responses.

## Optional Writing Domain Sample

The `demo/paper/` directory is retained as a writing-domain example only. Seed core behavior is domain-agnostic.
