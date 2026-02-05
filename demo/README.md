# CoAuthor Demo - M2 Tool Use Workflow

This directory provides a complete demonstration of the CoAuthor M2 milestone: **Agent Runtime with Tool Use and UIP (User Interaction Points)**.

## Overview

This demo showcases the `DefaultCoAuthorAgent` implementing the full tool use workflow:

1. **Tool Loop**: LLM calls → tool execution → repeat until completion
2. **Safe Tools** (`listFiles`, `readFile`): Execute directly without confirmation
3. **Risky Tools** (`editFile`): Require UIP confirmation with Diff preview
4. **Crash Recovery**: Conversation persistence via `ConversationStore`

## Demo Structure

```
demo/
├── README.md                    # This file
├── outline.md                   # Paper outline (for ContextBuilder)
├── brief.md                     # Research brief with project overview
├── fake-llm-config.ts          # Fake LLM preset responses for demo
├── paper/                       # LaTeX paper directory
│   ├── main.tex               # Main document with sections
│   └── sections/              # Individual section files
│       ├── introduction.tex   # Introduction (will be edited)
│       ├── related-work.tex   # Related work
│       ├── architecture.tex   # System architecture
│       ├── evaluation.tex     # Evaluation
│       └── conclusion.tex     # Conclusion
└── data/                      # Additional data files
    └── sample.txt             # Sample data for readFile demos
```

## Tool Use Coverage

This demo verifies all three tool types in `DefaultCoAuthorAgent`:

| Tool | Risk Level | UIP | Demo Scenario | Code Reference |
|------|-----------|-----|---------------|----------------|
| `listFiles` | safe | ❌ | Browse `paper/` directory | `#toolLoop` → execute safe tool |
| `readFile` | safe | ❌ | Read `main.tex` structure | `#toolLoop` → execute safe tool |
| `editFile` | **risky** | ✅ Diff | Edit `introduction.tex` | `#buildRiskyToolDisplay` → Diff preview → UIP |

## Running the Demo

### Prerequisites

Ensure your `.env` file is configured for Fake LLM mode:

```bash
# Use Fake LLM for repeatable demo
LLM_MODE=fake
FAKE_LLM_CONFIG_PATH=./demo/fake-llm-config.ts
```

### Step-by-Step Demo

#### 1. Create a Task

```bash
npm run dev -- task create "Improve paper introduction" \
  --intent "Edit the introduction.tex file to make the opening more engaging and clearly state the research contribution." \
  --refs demo/paper
```

#### 2. Start the Agent

```bash
npm run dev -- agent start <taskId>
```

#### 3. Observe the Tool Loop

The agent will execute the following sequence (from `fake-llm-config.ts`):

**Iteration 1: `listFiles`**
- Agent sends: "I'll start by exploring the paper structure..."
- Tool call: `listFiles(path: "demo/paper")`
- Result: Directory listing showing `main.tex` and `sections/`

**Iteration 2: `readFile`**
- Agent sends: "Now let me read the main.tex file..."
- Tool call: `readFile(path: "demo/paper/main.tex")`
- Result: Content of main.tex showing document structure

**Iteration 3: `editFile` (Risky - UIP Triggered)**
- Agent sends: "I'll modify the first paragraph to make it more engaging..."
- Tool call: `editFile(path: "demo/paper/sections/introduction.tex", ...)`
- **UIP Shown**: Diff preview of the proposed changes

#### 4. Confirm the UIP

When the UIP appears, you'll see:

```
┌─────────────────────────────────────────────────────────────┐
│ Confirm Risky Operation                                     │
├─────────────────────────────────────────────────────────────┤
│ Agent requests to edit file: introduction.tex               │
├─────────────────────────────────────────────────────────────┤
│ --- a/introduction.tex                                      │
│ +++ b/introduction.tex                                      │
│ @@ -1,5 +1,5 @@                                             │
│  This is the introduction section of our research paper.    │
│ +This paper presents a novel approach to collaborative...  │
├─────────────────────────────────────────────────────────────┤
│ [Approve (Danger)]  [Reject (Default)]                        │
└─────────────────────────────────────────────────────────────┘
```

Select **Approve** to allow the edit.

#### 5. View Results

After approval, the agent continues and completes the task. View the updated file:

```bash
cat demo/paper/sections/introduction.tex
```

### Running in TUI Mode

For an interactive graphical experience:

```bash
npm run dev
```

Then use the TUI commands:
- `task create "Demo task" --intent "..." --refs demo/paper`
- `agent start <taskId>`

## Fake LLM Configuration

The `fake-llm-config.ts` file defines preset responses that simulate a real LLM conversation:

```typescript
// Preset response sequence
demoResponseSequence: LLMResponse[] = [
  // 1. listFiles - Safe tool, executes immediately
  { content: "Exploring paper structure...", toolCalls: [{ toolName: 'listFiles', ... }] },

  // 2. readFile - Safe tool, executes immediately
  { content: "Reading main.tex...", toolCalls: [{ toolName: 'readFile', ... }] },

  // 3. editFile - Risky tool, triggers UIP with Diff preview
  { content: "Updating introduction...", toolCalls: [{ toolName: 'editFile', ... }] },

  // 4. Completion
  { content: "Task completed successfully!", toolCalls: [] }
]
```

To customize the demo, modify the `demoResponseSequence` array.

## Verification Checklist

After running the demo, verify:

- [ ] **listFiles** executed without UIP (safe tool)
- [ ] **readFile** executed without UIP (safe tool)
- [ ] **editFile** triggered UIP with Diff preview (risky tool)
- [ ] UIP displayed correct file path and diff content
- [ ] File was actually modified after UIP approval
- [ ] Conversation persisted across iterations

## Troubleshooting

### "Unknown tool" errors
- Check that tool names match exactly (case-sensitive)
- Verify tools are registered in `AgentRuntime`

### UIP not showing for editFile
- Check `riskLevel` is set to `'risky'` in tool definition
- Verify `DefaultCoAuthorAgent.#buildRiskyToolDisplay` handles the tool

### File not being modified
- Check file permissions
- Ensure path is relative to working directory
- Verify UIP was approved (not rejected)

## Next Steps

After understanding this demo:

1. **Try Real LLM Mode**: Change `LLM_MODE=openai` and set `OPENAI_API_KEY`
2. **Customize Tools**: Add new tools to `ToolRegistry` and handle them in `DefaultCoAuthorAgent`
3. **Extend UIP Types**: Implement `Select` and `Input` UIP types beyond `Confirm`
4. **Build M3 Features**: Add LaTeX compilation and preview capabilities

---

**Milestone**: M2 - Agent Runtime with Tool Use and UIP
**Agent**: `DefaultCoAuthorAgent`
**Architecture**: Hexagonal with Event Sourcing
