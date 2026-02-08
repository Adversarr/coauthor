import type { LLMMessage } from '../domain/ports/llmClient.js'
import type { ArtifactRef } from '../domain/task.js'
import type { TaskView } from './taskService.js'
import type { ArtifactStore } from '../domain/ports/artifactStore.js'

export class ContextBuilder {
  readonly #baseDir: string
  readonly #store: ArtifactStore

  constructor(baseDir: string, store: ArtifactStore) {
    this.#baseDir = baseDir
    this.#store = store
  }

  /**
   * Build system prompt for Tool Use workflow.
   */
  async buildSystemPrompt(): Promise<string> {
    const parts: string[] = []

    // Replace environment placeholders in system prompt
    const currentDate = new Date().toISOString().split('T')[0]
    const platform = process.platform
    const systemPrompt = SYSTEM_PROMPT
      .replace('{{WORKING_DIRECTORY}}', this.#baseDir)
      .replace('{{PLATFORM}}', platform)
      .replace('{{DATE}}', currentDate)

    parts.push(systemPrompt)

    // Try to load project-specific context files
    // Note: We use relative paths here, ArtifactStore handles resolution
    const outline = await this.#tryReadFile('OUTLINE.md')
    if (outline) {
      parts.push(`\n## Project Outline\n${outline}`)
    }

    const brief = await this.#tryReadFile('BRIEF.md')
    if (brief) {
      parts.push(`\n## Project Brief\n${brief}`)
    }

    const style = await this.#tryReadFile('STYLE.md')
    if (style) {
      parts.push(`\n## Style Guide\n${style}`)
    }

    return parts.join('\n')
  }

  /**
   * Build initial messages for a task.
   */
  async buildTaskMessages(task: TaskView): Promise<LLMMessage[]> {
    const messages: LLMMessage[] = []

    // System prompt
    messages.push({
      role: 'system',
      content: await this.buildSystemPrompt()
    })

    // User task
    const taskParts: string[] = []
    taskParts.push(`# Task: ${task.title}`)
    
    if (task.intent) {
      taskParts.push(`\n${task.intent}`)
    }

    if (task.artifactRefs && task.artifactRefs.length > 0) {
      taskParts.push('\n## Referenced Files')
      for (const ref of task.artifactRefs) {
        taskParts.push(await this.#renderArtifactRef(ref))
      }
    }

    messages.push({
      role: 'user',
      content: taskParts.join('\n')
    })

    return messages
  }

  async #tryReadFile(path: string): Promise<string | null> {
    try {
      if (await this.#store.exists(path)) {
        return await this.#store.readFile(path)
      }
      return null
    } catch {
      return null
    }
  }

  async #renderArtifactRef(ref: ArtifactRef): Promise<string> {
    if (ref.kind === 'file_range') {
      try {
        const content = await this.#store.readFileRange(ref.path, ref.lineStart, ref.lineEnd)
        
        // Add line numbers to the content for LLM context
        const lines = content.split('\n')
        const numbered = lines.map((line, i) => 
          `${String(ref.lineStart + i).padStart(4, ' ')}|${line}`
        ).join('\n')

        return `## File: ${ref.path} (L${ref.lineStart}-L${ref.lineEnd})\n\`\`\`\n${numbered}\n\`\`\``
      } catch {
        return `## File: ${ref.path} (L${ref.lineStart}-L${ref.lineEnd})\n(file not found)`
      }
    }

    return `## Ref: ${ref.kind}\n(skipped)`
  }
}


const SYSTEM_PROMPT = `
You are CoAuthor, an intelligent CLI assistant that helps the user complete tasks inside a local workspace.
You are not just a text editor. You can inspect files, make targeted edits, and run commands when necessary.

<system-reminder>
As you answer the user's questions, you can use the following context:
## important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files unless explicitly requested.
If editing structured formats (e.g., LaTeX/JSON), preserve their validity.
</system-reminder>

# System Prompt

You are an interactive CLI tool. Use the instructions below and the available tools to assist the user.

## Core Principles
1.  **User-Directed**: The user sets direction and makes final decisions.
2.  **Grounded**: Do not invent file content, project behavior, or results. Read files and use tool outputs as source of truth.
3.  **Minimal Scope**: Apply the smallest change that satisfies the request.
4.  **Format Safety**: If you edit a structured format, keep it valid.

## Tone and style
You should be concise, direct, and professional, while providing complete information.
A concise response is generally less than 4 lines, not including tool calls or generated content.
IMPORTANT: Minimize output tokens. Avoid "Here is the plan" or "I have finished". Just do the work.
Avoid conversational filler.
If you cannot help, offer helpful alternatives in 1-2 sentences.

<example>
user: What is in hello_world.tex?
assistant: [reads hello_world.tex]
It contains a minimal LaTeX document with "Hello World." in the body.
</example>

<example>
user: Change the content to "Hello World."
assistant: [reads file, edits matching span]
Updated the file content.
</example>

## Tool usage policy
- **Batching**: Combine related reads/edits into as few tool calls as possible.
- **Commands**: Avoid destructive commands unless the user explicitly asks.
- **Tool errors**: Treat tool outputs as authoritative; recover by re-reading and retrying.

IMPORTANT: User can work concurrently with you. After tool use failures (e.g. editing/writing files), you should re-read then retry to handle them.

<env>
Working directory: {{WORKING_DIRECTORY}}
Platform: {{PLATFORM}}
Date: {{DATE}}
</env>

IMPORTANT: Be helpful, rigorous, and honest about what you don't know.
`
