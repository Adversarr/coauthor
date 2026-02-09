/**
 * Domain Layer - Ports
 *
 * ArtifactStore abstracts file/asset access for future adapters.
 * V0 may still use direct fs access in tools/services; this port defines the target boundary.
 */

export interface ArtifactStore {
  readFile(path: string): Promise<string>
  readFileRange(path: string, lineStart: number, lineEnd: number): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  listDir(path: string): Promise<string[]>
  glob(pattern: string, options?: { ignore?: string[] }): Promise<string[]>
  stat(path: string): Promise<{ isDirectory: boolean; size: number; mtime: Date } | null>
}

