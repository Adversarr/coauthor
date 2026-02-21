import { describe, it, expect, beforeEach } from 'vitest'
import { vol } from 'memfs'
import { join } from 'node:path'
import { MemFsArtifactStore } from '../../src/infrastructure/filesystem/memFsArtifactStore.js'

// Tell vitest to mock 'fs' with memfs if we were doing module mocking, 
// but here we are using MemFsArtifactStore which directly imports from memfs.
// So we don't need vi.mock('node:fs') unless we want to intercept other calls.
// We just control vol.

describe('MemFsArtifactStore', () => {
  let store: MemFsArtifactStore
  const baseDir = '/workspace'

  beforeEach(() => {
    vol.reset()
    // Setup initial state
    vol.fromJSON({
      'test.txt': 'hello world',
      'subdir/subfile.txt': 'sub content'
    }, baseDir)
    
    store = new MemFsArtifactStore(baseDir)
  })

  it('should read file content', async () => {
    const content = await store.readFile('test.txt')
    expect(content).toBe('hello world')
  })

  it('should read file range', async () => {
    vol.writeFileSync(join(baseDir, 'lines.txt'), 'line1\nline2\nline3')
    const content = await store.readFileRange('lines.txt', 2, 2)
    expect(content).toBe('line2')
  })

  it('should write file', async () => {
    await store.writeFile('new.txt', 'new content')
    const content = vol.readFileSync(join(baseDir, 'new.txt'), 'utf8')
    expect(content).toBe('new content')
  })

  it('should check existence', async () => {
    expect(await store.exists('test.txt')).toBe(true)
    expect(await store.exists('missing.txt')).toBe(false)
  })

  it('should list directory', async () => {
    const entries = await store.listDir('.')
    expect(entries).toContain('test.txt')
    expect(entries).toContain('subdir')
  })

  it('should create directory', async () => {
    await store.mkdir('newdir/deep')
    expect(vol.existsSync(join(baseDir, 'newdir/deep'))).toBe(true)
  })

  it('should stat file', async () => {
    const fileStat = await store.stat('test.txt')
    expect(fileStat?.isDirectory).toBe(false)
    
    const dirStat = await store.stat('subdir')
    expect(dirStat?.isDirectory).toBe(true)
  })

  it('should throw when accessing outside baseDir', async () => {
    // memfs uses absolute paths, so /outside is outside /workspace
    await expect(store.readFile('../outside')).rejects.toThrow('Access denied')
  })

  it('should glob files with memfs fs adapter', async () => {
    vol.fromJSON({
      'src/a.ts': 'a',
      'src/b.ts': 'b',
      'src/c.js': 'c',
      'src/skip/ignored.ts': 'ignored'
    }, baseDir)

    const matches = await store.glob('src/**/*.ts', { ignore: ['src/skip/**'] })
    expect(matches).toHaveLength(2)
    expect(matches).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts']))
  })
})
