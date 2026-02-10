# Hard-coded Values and Missing Default Parameters

This document catalogs hard-coded values and missing default parameters found in the `/src/agents/`, `/src/application/`, `/src/app/`, and `/src/cli/` directories.

---

## Summary Table

| File | Hard-coded Values | Status | Risk Level |
|------|------------------|--------|------------|
| **AGENTS LAYER** |
| `baseAgent.ts` | 50 iterations, 4096 tokens | **Resolved** (Configurable via `AppConfig`) | Medium |
| `defaultAgent.ts` | Profile='fast', 4 tool groups | **Partially Resolved** (Profile configurable) | Low |
| `searchAgent.ts` | 20 iterations, profile='fast' | **Resolved** (Configurable via `AppConfig`) | Low |
| `minimalAgent.ts` | 4096 tokens, profile='fast' | **Resolved** (Configurable via `AppConfig`) | Medium |
| `displayBuilder.ts` | 30000ms timeout, UI labels | No config injection | Low |
| `templates.ts` | Entire prompt templates | No externalization | Medium |
| **APPLICATION LAYER** |
| `auditService.ts` | limit=20 entries | **Resolved** (Configurable via `AppConfig`) | Low |
| `contextBuilder.ts` | File names (OUTLINE.md, BRIEF.md, STYLE.md) | No config injection | Low |
| `interactionService.ts` | 300000ms timeout (5 min), 100ms poll interval | **Resolved** (Timeout configurable) | Medium |
| `taskService.ts` | Priority='foreground' | **Resolved** (Configurable via `AppConfig`) | Low |
| **APP LAYER** |
| `createApp.ts` | .coauthor paths, subtask depth=3 | Partial config via AppConfig | Medium |
| **TUI LAYER** |
| `main.tsx` | max log entries (2000), row calculations | No config injection | Low |
| `utils.ts` | Status icons, status labels, tree prefixes, truncation suffix | No config injection | Low |
| `components/TaskList.tsx` | Depth colors, agent colors, column widths, UI labels | No config injection | Low |
| `components/StatusBar.tsx` | UI labels, breadcrumb truncation | No config injection | Low |
| `components/StreamingOutput.tsx` | Icons, prefixes, colors | No config injection | Low |
| `components/InputPrompt.tsx` | Prompt prefix, color | No config injection | Low |
| `components/InteractionPane.tsx` | Mode hint format | No config injection | Low |
| `components/TaskDetail.tsx` | Child task limit, ID slice length | No config injection | Low |
| `commands.ts` | Valid LLM profiles, help text | No config injection | Low |
| **INFRASTRUCTURE LAYER** |
| `openaiLLMClient.ts` | Default baseURL, verbose env vars | Partial config | Low |
| `toolExecutor.ts` | Rejection error message | No config injection | Low |
| `tools/runCommand.ts` | Max output length, default timeout, buffer size, shell selection | **Resolved** (Configurable via factory) | Medium |
| `tools/editFile.ts` | New file check logic | No config injection | Low |
| `tools/readFile.ts` | Offset defaults, line number formatting | No config injection | Low |
| `tools/listFiles.ts` | Date format, sorting, entry format | No config injection | Low |
| `tools/globTool.ts` | File count threshold, sorting | No config injection | Low |
| `tools/grepTool.ts` | Regex flags, git grep args, system grep args | No config injection | Low |
| `tools/createSubtaskTool.ts` | Default subtask timeout, tool call ID prefix | No config injection | Medium |
| **DOMAIN LAYER** |
| All domain files | Clean implementations, no hard-coded values | N/A | Clean |
| `actor.ts` | Well-known actor IDs as constants | Proper use of constants | Clean |
| **CLI LAYER** |
| `commands/audit.ts` | default=20 limit, time format padding (24, 20, 10) | No config injection | Low |
| `commands/llm.ts` | maxTokens=50, 1024, maxToolIterations=4, profile='fast' | No config injection | Medium |
| `commands/task.ts` | Line regex `/^(\d+)-(\d+)$/`, file range parsing | Hard-coded logic | Low |
| `io.ts` | Buffer size, encoding='utf8' | No config injection | Low |
| `run.ts` | Default TUI when no args | Behavior default | Low |

---

## AGENTS LAYER - Detailed Findings

### 1. `baseAgent.ts` - Hard-coded Iteration Limits & Token Counts [RESOLVED]

**Status:** Resolved. Now configurable via `AppConfig` and injected through constructor.

**Config:**
- `COAUTHOR_AGENT_MAX_ITERATIONS` (default 50)
- `COAUTHOR_AGENT_MAX_TOKENS` (default 4096)

**Lines 32-34, 97-98:**
```typescript
readonly #maxIterations: number
// ...
this.#maxIterations = opts.maxIterations ?? 50  // Now injected from config
```

**Lines 131-132, 143-146:**
```typescript
maxTokens: 4096  // Hard-coded in TWO places (streaming and non-streaming)
```

**Issues:**
- No way to configure `maxIterations` or `maxTokens` from external config
- Different agents may need different limits, but base class hard-codes them
- Token limit of 4096 may be too restrictive for some models

---

### 2. `defaultAgent.ts` - Hard-coded Profile and Tool Groups [PARTIALLY RESOLVED]

**Status:** Partially Resolved. Profile is now configurable via `AppConfig`. Tool groups remain hard-coded for now.

**Config:**
- `COAUTHOR_AGENT_DEFAULT_PROFILE` (default 'fast')

**Lines 28-33:**
```typescript
readonly defaultProfile: LLMProfile // Now injected from config
readonly toolGroups: readonly ToolGroup[] = ['search', 'edit', 'exec', 'subtask']
```

**Line 35:**
```typescript
constructor(opts: { contextBuilder: ContextBuilder; maxIterations?: number; systemPromptTemplate?: string })
// Missing: profile, toolGroups, default parameters
```

**Issues:**
- `defaultProfile` cannot be configured per-deployment
- `toolGroups` is hard-coded and not overridable
- Constructor options lack defaults for most parameters

---

### 3. `searchAgent.ts` - Better Defaults But Still Hard-coded [RESOLVED]

**Status:** Resolved. Now configurable via `AppConfig`.

**Config:**
- `COAUTHOR_AGENT_MAX_ITERATIONS`
- `COAUTHOR_AGENT_DEFAULT_PROFILE`

**Lines 28-29:**
```typescript
readonly defaultProfile: LLMProfile // Now injected from config
readonly toolGroups: readonly ToolGroup[] = ['search']
```

**Line 31:**
```typescript
maxIterations: opts.maxIterations ?? 20  // Better default than base (20 vs 50)
```

**Issues:**
- Still uses hard-coded 'fast' profile
- Tool group cannot be configured
- 20 iterations may still be arbitrary

---

### 4. `minimalAgent.ts` - Token Limit Hard-coded [RESOLVED]

**Status:** Resolved. Now configurable via `AppConfig`.

**Config:**
- `COAUTHOR_AGENT_MAX_TOKENS`

**Lines 42-45:**
```typescript
const llmResponse = await context.llm.complete({
  profile,
  messages,
  maxTokens // Now injected from config
})
```

**Issues:**
- No configuration option for `maxTokens`
- Same 4096 limit as other agents, inconsistent with "minimal" concept

---

### 5. `displayBuilder.ts` - Timeout and UI Strings Hard-coded

**Lines 63-65:**
```typescript
const timeout = args.timeout || 30000  // 30 seconds hard-coded default
```

**Lines 54-57:**
```typescript
const content = [
  `Command: ${command}`,
  `CWD: ${cwd}`,
  `Timeout: ${timeout}ms`
].join('\n')
```

**Lines 89-93:**
```typescript
options: [
  { id: 'approve', label: 'Approve', style: 'danger' },
  { id: 'reject', label: 'Reject', style: 'default', isDefault: true }
]
```

**Issues:**
- Timeout default not configurable
- UI labels ('Approve', 'Reject') not internationalizable
- Content formatting hard-coded

---

### 6. `templates.ts` - Entire System Prompts Hard-coded

**Entire file (107 lines):** All system prompt templates are hard-coded strings with template variables like `{{WORKING_DIRECTORY}}`, `{{PLATFORM}}`, `{{DATE}}`.

**Issues:**
- Prompts cannot be customized without code changes
- No external configuration mechanism
- Template variables are processed at runtime but templates themselves are static

---

## APPLICATION LAYER - Detailed Findings

### 1. `auditService.ts` - Hard-coded Default Limit [RESOLVED]

**Status:** Resolved. Now configurable via `AppConfig`.

**Config:**
- `COAUTHOR_AUDIT_LOG_LIMIT` (default 20)

**Lines 44-47:**
```typescript
async getRecentEntries(taskId?: string, limit?: number): Promise<StoredAuditEntry[]> {
  // ...
  return entries.slice(0, limit ?? this.#defaultLimit)
}
```

**Issues:**
- Default limit of 20 entries is hard-coded
- Cannot be configured per-deployment
- CLI command uses same default (duplicate hard-coding)

---

### 2. `contextBuilder.ts` - Hard-coded File Names

**Lines 25-29:**
```typescript
async getContextData(): Promise<ContextData> {
  const outline = await this.#tryReadFile('OUTLINE.md')
  const brief = await this.#tryReadFile('BRIEF.md')
  const style = await this.#tryReadFile('STYLE.md')
  // ...
}
```

**Issues:**
- File names ('OUTLINE.md', 'BRIEF.md', 'STYLE.md') are hard-coded
- Cannot be customized for different project structures
- No way to configure additional context files

---

### 3. `interactionService.ts` - Hard-coded Timeout and Polling [RESOLVED]

**Status:** Resolved. Timeout is now configurable via `AppConfig`.

**Config:**
- `COAUTHOR_TIMEOUT_INTERACTION` (default 300000ms)

**Lines 158-159:**
```typescript
const timeoutMs = opts?.timeoutMs ?? this.#defaultTimeoutMs
const pollIntervalMs = opts?.pollIntervalMs ?? 100
```

**Issues:**
- 5-minute timeout (300000ms) is hard-coded as default
- 100ms poll interval is hard-coded
- While these can be overridden via `opts`, the defaults are not configurable

---

### 4. `taskService.ts` - Hard-coded Priority Default [RESOLVED]

**Status:** Resolved. Now configurable via `AppConfig`.

**Config:**
- `COAUTHOR_TASK_DEFAULT_PRIORITY` (default 'foreground')

**Lines 93-94:**
```typescript
async createTask(opts: CreateTaskOptions): Promise<{ taskId: string }> {
  // ...
  priority: opts.priority ?? this.#defaultPriority
  // ...
}
```

**Issues:**
- Default task priority 'foreground' is hard-coded
- Cannot be configured per-deployment
- All new tasks default to foreground unless explicitly specified

---

## APP LAYER - Detailed Findings

### 1. `createApp.ts` - Hard-coded Paths and Defaults

**Lines 113-128:**
```typescript
const eventsPath = opts.eventsPath ?? join(baseDir, '.coauthor', 'events.jsonl')
// ...
const auditLogPath = opts.auditLogPath ?? join(baseDir, '.coauthor', 'audit.jsonl')
// ...
const conversationsPath = opts.conversationsPath ?? join(baseDir, '.coauthor', 'conversations.jsonl')
```

**Line 243:**
```typescript
maxSubtaskDepth: config.maxSubtaskDepth ?? 3
```

**Issues:**
- `.coauthor` directory name is hard-coded in multiple places
- Default subtask depth of 3 is hard-coded
- While paths can be overridden via opts, the defaults are not centralized

---

## INFRASTRUCTURE LAYER - Detailed Findings

### 1. `tools/runCommand.ts` - Hard-coded Limits and Timeouts [RESOLVED]

**Status:** Resolved. Now configurable via `createRunCommandTool` factory and `AppConfig`.

**Config:**
- `COAUTHOR_MAX_OUTPUT_LENGTH` (default 10000)
- `COAUTHOR_TIMEOUT_EXEC` (default 30000ms)

**Implementation:**
```typescript
export function createRunCommandTool(opts?: { maxOutputLength?: number; defaultTimeout?: number }): Tool {
  // ...
}
```

---

## CLI LAYER - Detailed Findings

### 1. `commands/audit.ts` - Hard-coded Formatting Values

**Lines 47-56:**
```typescript
io.stdout(
  'Time'.padEnd(24) + 
  'Tool'.padEnd(20) + 
  'Type'.padEnd(20) + 
  'Status'.padEnd(10) + 
  'Duration'.padEnd(10) + 
  '\n'
)
io.stdout('-'.repeat(90) + '\n')
```

**Issues:**
- Column widths (24, 20, 20, 10, 10) are hard-coded
- Separator length (90) is hard-coded
- Cannot adapt to different terminal widths or user preferences

---

### 2. `commands/llm.ts` - Hard-coded Test Parameters

**Lines 34-35:**
```typescript
maxTokens: 50
```

**Lines 76-77:**
```typescript
maxTokens: 1024
const maxToolIterations = 4
```

**Lines 52, 93, 156, 185:**
```typescript
profile: 'fast'
```

**Issues:**
- Multiple hard-coded maxTokens values (50, 1024)
- maxToolIterations of 4 is hard-coded
- LLM profile 'fast' is hard-coded in multiple places
- Cannot configure test behavior without code changes

---

### 3. `commands/task.ts` - Hard-coded Parsing Logic

**Lines 42-43:**
```typescript
const m = /^(\d+)-(\d+)$/.exec(lines)
if (!m) throw new Error('lines format error, should be <start>-<end>, e.g. 10-20')
```

**Issues:**
- Line range regex pattern is hard-coded
- Error message format is hard-coded
- Cannot customize line range format (e.g., using `:` instead of `-`)

---

### 4. `io.ts` - Hard-coded Buffer Handling

**Lines 11-17:**
```typescript
readStdin: () =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.resume()
    process.stdin.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  }),
```

**Issues:**
- Buffer chunking strategy is hard-coded
- Encoding 'utf8' is hard-coded
- Cannot configure stdin reading behavior

---

### 5. `run.ts` - Hard-coded Default Behavior

**Lines 51-55:**
```typescript
// Default behavior: run TUI if no arguments
if (argv.length === 0) {
  const { runMainTui } = await import('../tui/run.js')
  await runMainTui(app)
  return 0
}
```

**Issues:**
- Default behavior (launch TUI when no args) is hard-coded
- Cannot configure different default behavior

---

## Recommendations

### High Priority
1. **Extract magic numbers to config**: [DONE] `maxIterations`, `maxTokens`, timeouts, default priorities
2. **Make LLM profiles configurable**: [DONE] Added to `AppConfig`
3. **Externalize system prompts**: [PENDING] Load from config files or environment
4. **Centralize default values**: [DONE] Centralized in `AppConfig` and injected via `createApp`

### Medium Priority
5. **Add constructor defaults**: [DONE] Most service/agent constructors now accept config with fallback defaults
6. **UI internationalization**: Make labels and messages configurable
7. **Tool group configurability**: Allow runtime modification of available tools
8. **CLI formatting**: Make column widths and formats configurable

### Low Priority
9. **Template hot-reloading**: Allow prompt templates to be updated without restart
10. **Per-task overrides**: Allow individual tasks to specify iteration/token limits
11. **Custom context files**: Allow configuring which files are loaded for context

---

## Related Files

### Agents Layer
- `src/agents/baseAgent.ts` - Base class with hard-coded iteration/token limits
- `src/agents/defaultAgent.ts` - Default agent with hard-coded profile/tool groups
- `src/agents/searchAgent.ts` - Search agent with hard-coded defaults
- `src/agents/minimalAgent.ts` - Minimal agent with hard-coded token limit
- `src/agents/displayBuilder.ts` - UI builder with hard-coded timeouts/labels
- `src/agents/templates.ts` - System prompt templates (all hard-coded)

### Application Layer
- `src/application/auditService.ts` - Hard-coded default limit (20 entries)
- `src/application/contextBuilder.ts` - Hard-coded context file names
- `src/application/interactionService.ts` - Hard-coded timeout (5 min) and poll interval (100ms)
- `src/application/taskService.ts` - Hard-coded default priority ('foreground')
- `src/application/projector.ts` - No hard-coded values (clean)
- `src/application/eventService.ts` - No hard-coded values (clean)

### App Layer
- `src/app/createApp.ts` - Hard-coded paths (.coauthor), subtask depth (3)

### TUI Layer
- `src/tui/main.tsx` - Hard-coded values: max log entries (2000), streaming buffer refs, row calculations (rows - 9, rows - 10)
- `src/tui/utils.ts` - Hard-coded: status icons (⚪, 🔵, 🟡, ⏸️, 🟢, 🔴, ⚪), status labels, tree prefixes (├─, └─, │ ), truncation suffix (…), markdown terminal width min (20), separator char (─)
- `src/tui/components/TaskList.tsx` - Hard-coded: depth colors array (cyan, magenta, yellow, blue, green), agent colors map (default, search, minimal), column width calculations (columns - 60, columns - 8), UI labels (ESC close, ↑↓ nav, Enter focus, Tab toggle), max visible task rows calculation
- `src/tui/components/StatusBar.tsx` - Hard-coded: UI labels (CoAuthor, Tab:tasks, Ctrl+D:exit, │), breadcrumb truncation (columns - 40, columns - 60), status display defaults
- `src/tui/components/StreamingOutput.tsx` - Hard-coded: icon (󰧑), prefix (→ ), colors (gray, green)
- `src/tui/components/InputPrompt.tsx` - Hard-coded: prompt prefix (> ), color (cyan)
- `src/tui/components/InteractionPane.tsx` - Hard-coded: mode hint format (→ /continue to "...")
- `src/tui/components/TaskDetail.tsx` - Hard-coded: child task slice limit (5), ID slice length (0, 12, 8), border styles (single, double), colors (gray, cyan)
- `src/tui/commands.ts` - Hard-coded: valid LLM profiles (fast, writer, reasoning), help text content

### Infrastructure Layer
- `src/infra/openaiLLMClient.ts` - Hard-coded: default baseURL (https://api.openai.com/v1), verbose env vars (COAUTHOR_LLM_VERBOSE), OpenAI provider options (enable_thinking: true)
- `src/infra/toolRegistry.ts` - Clean implementation, no hard-coded values
- `src/infra/toolExecutor.ts` - Hard-coded: rejection error message ('User rejected the request')
- `src/infra/tools/runCommand.ts` - Hard-coded: max output length (10000), default timeout (30000ms), buffer size (1024 * 1024), shell selection (win32 → cmd.exe, otherwise /bin/sh), encoding (utf8), kill signal (SIGTERM)
- `src/infra/tools/editFile.ts` - Hard-coded: empty string check for new file creation (oldString === ''), strategy tracking in output
- `src/infra/tools/readFile.ts` - Hard-coded: offset/limit defaults (offset: 0), line number formatting (padStart: 4, separator: |), status message format
- `src/infra/tools/listFiles.ts` - Hard-coded: date format (YYYY-MM-DD HH:MM), sorting (directories first, then alphabetical), entry format ([DIR] prefix, size formatting, date suffix)
- `src/infra/tools/globTool.ts` - Hard-coded: file count threshold (100), sorting (newest first, fallback to alphabetical)
- `src/infra/tools/grepTool.ts` - Hard-coded: regex flags (m - multiline), git grep args (-I, -n, -E), system grep args (-r, -I, -n, -E), fallback pattern (**/*)
- `src/infra/tools/createSubtaskTool.ts` - Hard-coded: default subtask timeout (300000ms = 5 min), tool call ID prefix (tool_)
- `src/infra/jsonlAuditLog.ts` - Clean implementation, no hard-coded values
- `src/infra/jsonlEventStore.ts` - Clean implementation, no hard-coded values
- `src/infra/jsonlConversationStore.ts` - Clean implementation, no hard-coded values
- `src/infra/fsArtifactStore.ts` - Clean implementation, no hard-coded values
- `src/infra/asyncMutex.ts` - Clean implementation, no hard-coded values
- `src/infra/subjectUiBus.ts` - Clean implementation, no hard-coded values
- `src/infra/toolSchemaAdapter.ts` - Clean implementation, no hard-coded values
- `src/infra/filteredToolRegistry.ts` - Clean implementation, no hard-coded values

### Domain Layer
- `src/domain/events.ts` - Clean implementation, uses Zod schemas with defaults
- `src/domain/task.ts` - Clean implementation, uses Zod schemas with defaults
- `src/domain/actor.ts` - Clean implementation, defines well-known actor IDs as constants (SYSTEM_ACTOR_ID, DEFAULT_USER_ACTOR_ID, DEFAULT_AGENT_ACTOR_ID)
- `src/domain/artifact.ts` - Clean implementation, uses Zod schemas
- `src/domain/context.ts` - Clean implementation, simple type definitions
- `src/domain/ports/llmClient.ts` - Clean implementation, type definitions only
- `src/domain/ports/tool.ts` - Clean implementation, defines ToolGroup as union type ('search' | 'edit' | 'exec' | 'subtask')
- `src/domain/ports/auditLog.ts` - Clean implementation, uses Zod schemas
- `src/domain/ports/eventStore.ts` - Clean implementation, interface definitions
- `src/domain/ports/artifactStore.ts` - Clean implementation, interface definitions
- `src/domain/ports/conversationStore.ts` - Clean implementation, uses Zod schemas
- `src/domain/ports/subscribable.ts` - Clean implementation, interface definitions
- `src/domain/ports/uiBus.ts` - Clean implementation, interface definitions
- `src/domain/ports/telemetry.ts` - Clean implementation, interface definitions

### CLI Layer
- `src/cli/run.ts` - Hard-coded default behavior (TUI when no args)
- `src/cli/io.ts` - Hard-coded buffer handling and encoding
- `src/cli/commands/audit.ts` - Hard-coded column widths and formatting
- `src/cli/commands/agent.ts` - No hard-coded values (clean)
- `src/cli/commands/interact.ts` - No hard-coded values (clean)
- `src/cli/commands/llm.ts` - Hard-coded maxTokens (50, 1024), maxToolIterations (4), profile ('fast')
- `src/cli/commands/log.ts` - No hard-coded values (clean)
- `src/cli/commands/task.ts` - Hard-coded line range regex pattern
- `src/cli/commands/ui.ts` - No hard-coded values (clean)
- `src/cli/commands/utils.ts` - Status icon mapping (acceptable as UI constants)
