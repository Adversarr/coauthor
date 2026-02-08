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
      vol.fromJSON({
        'file.txt': 'Hello'
      }, baseDir)

      await expect(editFileTool.canExecute!({
        path: 'file.txt',
        oldString: '',
        newString: 'Hello'
      }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store } as any)).rejects.toThrow('File already exists')
    })

    it('should throw if oldString not found', async () => {
      vol.fromJSON({
        'file.txt': 'Hello World'
      }, baseDir)

      await expect(editFileTool.canExecute!({
        path: 'file.txt',
        oldString: 'Universe',
        newString: 'CoAuthor'
      }, { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store } as any)).rejects.toThrow('oldString not found')
    })
  })
})
