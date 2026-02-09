import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vol } from 'memfs'
import { join } from 'node:path'
import { editFileTool } from '../../src/infra/tools/editFile.js'
import { MemFsArtifactStore } from '../../src/infra/memFsArtifactStore.js'

describe('editFileTool', () => {
  const baseDir = '/test-workspace'
  let store: MemFsArtifactStore

  beforeEach(() => {
    vol.reset()
    store = new MemFsArtifactStore(baseDir)
    vol.mkdirSync(baseDir, { recursive: true })
  })

  it('should create a new file when oldString is empty', async () => {
    const result = await editFileTool.execute({
      path: 'newfile.txt',
      oldString: '',
      newString: 'Hello World'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({ success: true, action: 'created' })
    expect(vol.readFileSync(join(baseDir, 'newfile.txt'), 'utf8')).toBe('Hello World')
  })

  it('should edit an existing file', async () => {
    vol.fromJSON({
      'file.txt': 'Hello World'
    }, baseDir)

    const result = await editFileTool.execute({
      path: 'file.txt',
      oldString: 'World',
      newString: 'CoAuthor'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({ success: true, action: 'edited' })
    expect(vol.readFileSync(join(baseDir, 'file.txt'), 'utf8')).toBe('Hello CoAuthor')
  })

  it('should fail if oldString is not found', async () => {
    vol.fromJSON({
      'file.txt': 'Hello World'
    }, baseDir)

    const result = await editFileTool.execute({
      path: 'file.txt',
      oldString: 'Universe',
      newString: 'CoAuthor'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('oldString not found')
    expect(vol.readFileSync(join(baseDir, 'file.txt'), 'utf8')).toBe('Hello World')
  })

  it('should fail if oldString is ambiguous (multiple matches)', async () => {
    vol.fromJSON({
      'file.txt': 'Hello World World'
    }, baseDir)

    const result = await editFileTool.execute({
      path: 'file.txt',
      oldString: 'World',
      newString: 'CoAuthor'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('oldString found 2 times')
  })

  it('should support regex replacement', async () => {
    vol.fromJSON({
      'file.txt': 'Hello 123 World'
    }, baseDir)

    const result = await editFileTool.execute({
      path: 'file.txt',
      oldString: '\\d+',
      newString: 'NUM',
      regex: true
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({ success: true, action: 'edited', strategy: 'regex' })
    expect(vol.readFileSync(join(baseDir, 'file.txt'), 'utf8')).toBe('Hello NUM World')
  })

  it('should support flexible match (whitespace insensitive)', async () => {
    vol.fromJSON({
      'file.txt': 'function foo(  ) {\n  return true\n}'
    }, baseDir)

    // Match with different whitespace
    const oldString = 'function foo() {\n return true\n}'
    const newString = 'function bar() {}'

    const result = await editFileTool.execute({
      path: 'file.txt',
      oldString,
      newString,
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({ success: true, action: 'edited', strategy: 'flexible' })
    expect(vol.readFileSync(join(baseDir, 'file.txt'), 'utf8')).toBe('function bar() {}')
  })

  it('should fail if file does not exist', async () => {
    const result = await editFileTool.execute({
      path: 'missing.txt',
      oldString: 'foo',
      newString: 'bar'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('File not found')
  })
})
