import { fs } from 'memfs'
import { resolve, sep } from 'node:path'
import { glob } from 'glob'
import type { GlobOptions } from 'glob'
import type { ArtifactStore } from '../../core/ports/artifactStore.js'

type GlobFsAdapter = NonNullable<GlobOptions['fs']>

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
    const entries = await fs.promises.readdir(resolved, { withFileTypes: true })
    return entries.map((entry) => {
      if (typeof entry === 'string') return entry
      if (Buffer.isBuffer(entry)) return entry.toString()
      if (entry && typeof entry === 'object' && 'name' in entry) {
        return String(entry.name)
      }
      return String(entry)
    })
  }

  async writeFile(path: string, content: string): Promise<void> {
    const resolved = this._resolve(path)
    await fs.promises.writeFile(resolved, content, { encoding: 'utf8' })
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

  async glob(pattern: string, options?: { ignore?: string[] }): Promise<string[]> {
    // memfs volume is at this.#baseDir usually if configured right, or root.
    // memfs.fs usually works on a global volume or we need to pass the volume?
    // glob accepts 'fs' option.
    const globFs = fs as unknown as GlobFsAdapter
    const matches = await glob(pattern, {
      cwd: this.#baseDir,
      fs: globFs,
      ignore: options?.ignore
    })
    return matches
  }

  async stat(path: string): Promise<{ isDirectory: boolean; size: number; mtime: Date } | null> {
    const resolved = this._resolve(path)
    try {
      const s = await fs.promises.stat(resolved)
      return { 
        isDirectory: s.isDirectory(),
        size: Number(s.size),
        mtime: new Date(s.mtime)
      }
    } catch {
      return null
    }
  }
}
