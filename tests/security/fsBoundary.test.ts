import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { FsArtifactStore } from '../../src/infrastructure/filesystem/fsArtifactStore.js'

describe('Security: FsArtifactStore Boundary Enforement', () => {
  let rootDir: string
  let baseDir: string
  let outsideFile: string
  let store: FsArtifactStore

  beforeEach(() => {
    // Structure:
    // /tmp/test-xxxx/ (rootDir)
    //   outside.txt
    //   base/ (baseDir)
    //     inside.txt
    
    rootDir = mkdtempSync(join(tmpdir(), 'seed-security-'))
    baseDir = join(rootDir, 'base')
    outsideFile = join(rootDir, 'outside.txt')
    
    mkdirSync(baseDir)
    writeFileSync(outsideFile, 'secret content')
    writeFileSync(join(baseDir, 'inside.txt'), 'safe content')
    
    store = new FsArtifactStore(baseDir)
  })

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('should allow access to files inside baseDir', async () => {
    const content = await store.readFile('inside.txt')
    expect(content).toBe('safe content')
  })

  it('should allow access using .. that stays inside baseDir', async () => {
    mkdirSync(join(baseDir, 'subdir'))
    const content = await store.readFile('subdir/../inside.txt')
    expect(content).toBe('safe content')
  })

  it('should block readFile access to files outside baseDir via traversal', async () => {
    await expect(store.readFile('../outside.txt'))
      .rejects.toThrow('Access denied')
  })

  it('should block readFile access to files outside baseDir via absolute path', async () => {
    await expect(store.readFile(outsideFile))
      .rejects.toThrow('Access denied')
  })

  it('should block writeFile outside baseDir', async () => {
    await expect(store.writeFile('../hacked.txt', 'hacked'))
      .rejects.toThrow('Access denied')
  })

  it('should block listDir outside baseDir', async () => {
    await expect(store.listDir('..'))
      .rejects.toThrow('Access denied')
  })

  it('should block mkdir outside baseDir', async () => {
    await expect(store.mkdir('../newdir'))
      .rejects.toThrow('Access denied')
  })

  it('should block exists check outside baseDir', async () => {
    await expect(store.exists('../outside.txt'))
      .rejects.toThrow('Access denied')
  })

  it('should block stat check outside baseDir', async () => {
    await expect(store.stat('../outside.txt'))
      .rejects.toThrow('Access denied')
  })
})
