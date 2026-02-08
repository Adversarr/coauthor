import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { editFileTool } from '../../src/infra/tools/editFile.js'
import { FsArtifactStore } from '../../src/infra/fsArtifactStore.js'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'

describe('editFileTool', () => {
  let baseDir: string
  let store: FsArtifactStore

  beforeEach(() => {
    baseDir = join(tmpdir(), `coauthor-test-${nanoid()}`)
    mkdirSync(baseDir, { recursive: true })
    store = new FsArtifactStore(baseDir)
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('should create a new file when oldString is empty', async () => {
    const result = await editFileTool.execute({
      path: 'newfile.txt',
      oldString: '',
      newString: 'Hello World'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({ success: true, action: 'created' })
    expect(readFileSync(join(baseDir, 'newfile.txt'), 'utf8')).toBe('Hello World')
  })

  it('should edit an existing file', async () => {
    writeFileSync(join(baseDir, 'file.txt'), 'Hello World')

    const result = await editFileTool.execute({
      path: 'file.txt',
      oldString: 'World',
      newString: 'CoAuthor'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({ success: true, action: 'edited' })
    expect(readFileSync(join(baseDir, 'file.txt'), 'utf8')).toBe('Hello CoAuthor')
  })

  it('should fail if oldString is not found', async () => {
    writeFileSync(join(baseDir, 'file.txt'), 'Hello World')

    const result = await editFileTool.execute({
      path: 'file.txt',
      oldString: 'Universe',
      newString: 'CoAuthor'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('oldString not found')
    expect(readFileSync(join(baseDir, 'file.txt'), 'utf8')).toBe('Hello World')
  })

  it('should fail if oldString is ambiguous (multiple matches)', async () => {
    writeFileSync(join(baseDir, 'file.txt'), 'Hello World World')

    const result = await editFileTool.execute({
      path: 'file.txt',
      oldString: 'World',
      newString: 'CoAuthor'
    }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('oldString found 2 times')
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

  describe('canExecute', () => {
    it('should pass for valid creation', async () => {
      await expect(editFileTool.canExecute!({
        path: 'newfile.txt',
        oldString: '',
        newString: 'Hello'
      }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store } as any)).resolves.toBeUndefined()
    })

    it('should throw if file already exists for creation', async () => {
      writeFileSync(join(baseDir, 'file.txt'), 'Hello')
      await expect(editFileTool.canExecute!({
        path: 'file.txt',
        oldString: '',
        newString: 'Hello'
      }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store } as any)).rejects.toThrow('File already exists')
    })

    it('should throw if oldString not found', async () => {
      writeFileSync(join(baseDir, 'file.txt'), 'Hello World')
      await expect(editFileTool.canExecute!({
        path: 'file.txt',
        oldString: 'Universe',
        newString: 'CoAuthor'
      }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store } as any)).rejects.toThrow('oldString not found')
    })
  })
})
