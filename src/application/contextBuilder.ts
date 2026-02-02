import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LLMMessage } from '../domain/ports/llmClient.js'
import type { ArtifactRef } from '../domain/task.js'
import type { TaskView } from './taskService.js'

function readFileRange(absolutePath: string, lineStart: number, lineEnd: number): string {
  const raw = readFileSync(absolutePath, 'utf8')
  const lines = raw.split('\n')
  const startIdx = Math.max(0, lineStart - 1)
  const endIdx = Math.min(lines.length - 1, lineEnd - 1)
  const slice = lines.slice(startIdx, endIdx + 1)
  const numbered = slice.map((line, i) => `${String(lineStart + i).padStart(4, ' ')}|${line}`)
  return numbered.join('\n')
}

function renderArtifactRef(baseDir: string, ref: ArtifactRef): string {
  if (ref.kind === 'file_range') {
    const abs = resolve(baseDir, ref.path)
    const content = readFileRange(abs, ref.lineStart, ref.lineEnd)
    return `## File: ${ref.path} (L${ref.lineStart}-L${ref.lineEnd})\n${content}`
  }

  return `## Ref: ${ref.kind}\n(skipped)`
}

export class ContextBuilder {
  readonly #baseDir: string

  constructor(baseDir: string) {
    this.#baseDir = baseDir
  }

  buildTaskMessages(task: TaskView): LLMMessage[] {
    const parts: string[] = []
    parts.push(`# Task\n- id: ${task.taskId}\n- title: ${task.title}\n- intent: ${task.intent}\n`)

    if (task.artifactRefs && task.artifactRefs.length > 0) {
      parts.push('# Context')
      for (const ref of task.artifactRefs) {
        parts.push(renderArtifactRef(this.#baseDir, ref))
      }
    }

    parts.push(
      [
        '# Output Format',
        'Return ONLY a JSON object that matches:',
        '{ "goal": string, "strategy": string, "scope": string, "issues"?: string[], "risks"?: string[], "questions"?: string[] }'
      ].join('\n')
    )

    return [
      {
        role: 'user',
        content: parts.join('\n\n')
      }
    ]
  }
}

