import { fs } from 'memfs'
import { resolve, sep } from 'node:path'
import type { ArtifactStore } from '../domain/ports/artifactStore.js'

export class MemFsArtifactStore implements ArtifactStore {
  readonly #baseDir: string

  constructor(baseDir: string) {
    this.#baseDir = resolve(baseDir)
  }

  private _resolve(path: string): string {
    const resolved = resolve(this.#baseDir, path)
    // Ensure resolved path is within baseDir
    if (resolved !== this.#baseDir && !resolved.startsWith(this.#baseDir + sep)) {
      throw new Error(`Access denied: Path '${path}' resolves to '${resolved}' which is outside base directory '${this.#baseDir}'`)
    }
    return resolved
  }

  async readFile(path: string): Promise<string> {
    const resolved = this._resolve(path)
    return fs.promises.readFile(resolved, 'utf8') as Promise<string>
  }

  async readFileRange(path: string, lineStart: number, lineEnd: number): Promise<string> {
    const content = await this.readFile(path)
    const lines = content.split('\n')
    const startIdx = Math.max(0, lineStart - 1)
    const endIdx = Math.min(lines.length - 1, lineEnd - 1)
    
    if (startIdx > endIdx) return ''
    
    const slice = lines.slice(startIdx, endIdx + 1)
    return slice.join('\n')
  }

  async listDir(path: string): Promise<string[]> {
    const resolved = this._resolve(path)
    // memfs readdir returns generic types, casting to match
    const entries = await fs.promises.readdir(resolved, { withFileTypes: true })
    return entries.map(e => e.name.toString())
  }

  async writeFile(path: string, content: string): Promise<void> {
    const resolved = this._resolve(path)
    await fs.promises.writeFile(resolved, content, 'utf8')
  }

  async exists(path: string): Promise<boolean> {
    const resolved = this._resolve(path)
    try {
      await fs.promises.access(resolved, fs.constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  async mkdir(path: string): Promise<void> {
    const resolved = this._resolve(path)
    await fs.promises.mkdir(resolved, { recursive: true })
  }

  async stat(path: string): Promise<{ isDirectory: boolean } | null> {
    const resolved = this._resolve(path)
    try {
      const s = await fs.promises.stat(resolved)
      return { isDirectory: s.isDirectory() }
    } catch {
      return null
    }
  }
}
