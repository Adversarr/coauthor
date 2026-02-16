import type { ArtifactRef } from '../../core/entities/task.js'
import type { TaskView } from '../services/taskService.js'
import type { ArtifactStore } from '../../core/ports/artifactStore.js'
import type { ContextData } from '../../core/entities/context.js'

export class ContextBuilder {
  readonly #baseDir: string
  readonly #store: ArtifactStore

  constructor(baseDir: string, store: ArtifactStore) {
    this.#baseDir = baseDir
    this.#store = store
  }

  /**
   * Get structured context data (Environment + Project).
   */
  async getContextData(): Promise<ContextData> {
    const agentsMd = await this.#tryReadFile('AGENTS.md')

    return {
      env: {
        workingDirectory: this.#baseDir,
        platform: process.platform,
        date: new Date().toISOString().split('T')[0]
      },
      project: {
        agentsMd: agentsMd ?? undefined
      }
    }
  }

  /**
   * Build User content for a task (Title, Intent, Artifacts).
   */
  async buildUserTaskContent(task: TaskView): Promise<string> {
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

    return taskParts.join('\n')
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

