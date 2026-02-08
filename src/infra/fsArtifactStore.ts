import { readFile, writeFile, readdir, mkdir, access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { ArtifactStore } from '../domain/ports/artifactStore.js'

export class FsArtifactStore implements ArtifactStore {
  readonly #baseDir: string

  constructor(baseDir: string) {
    this.#baseDir = resolve(baseDir)
  }

  private _resolve(path: string): string {
    const resolved = resolve(this.#baseDir, path)
    // Ensure resolved path is within baseDir
    // We check if it starts with baseDir + sep to avoid partial matches (e.g. /tmp/foo vs /tmp/foobar)
    // We also allow exact match (resolved === baseDir)
    if (resolved !== this.#baseDir && !resolved.startsWith(this.#baseDir + sep)) {
      throw new Error(`Access denied: Path '${path}' resolves to '${resolved}' which is outside base directory '${this.#baseDir}'`)
    }
    return resolved
  }

  async readFile(path: string): Promise<string> {
    // _resolve throws if access denied, propagating out
    return readFile(this._resolve(path), 'utf8')
  }

  async readFileRange(path: string, lineStart: number, lineEnd: number): Promise<string> {
    const content = await this.readFile(path)
    const lines = content.split('\n')
    // lineStart and lineEnd are 1-based inclusive
    const startIdx = Math.max(0, lineStart - 1)
    const endIdx = Math.min(lines.length - 1, lineEnd - 1)
    
    // Safety check: if start > end or start out of bounds, return empty or handle gracefully
    if (startIdx > endIdx) return ''
    
    const slice = lines.slice(startIdx, endIdx + 1)
    return slice.join('\n')
  }

  async listDir(path: string): Promise<string[]> {
    const absPath = this._resolve(path)
    const entries = await readdir(absPath, { withFileTypes: true })
    return entries.map(e => e.name)
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(this._resolve(path), content, 'utf8')
  }

  async exists(path: string): Promise<boolean> {
    // Validate path first - throws if access denied
    const resolved = this._resolve(path)
    try {
      await access(resolved, constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(this._resolve(path), { recursive: true })
  }

  async stat(path: string): Promise<{ isDirectory: boolean } | null> {
    // Validate path first - throws if access denied
    const resolved = this._resolve(path)
    try {
      const s = await stat(resolved)
      return { isDirectory: s.isDirectory() }
    } catch {
      return null
    }
  }
}
