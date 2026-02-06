import { describe, expect, test } from 'vitest'
import mockFs from 'mock-fs'
import { readFile } from 'node:fs/promises'
import { applyUnifiedPatchToFile } from '../src/patch/applyUnifiedPatch.js'

describe('applyUnifiedPatchToFile', () => {
  test('applies unified diff to target file', async () => {
    mockFs({
      repo: {
        'doc.tex': 'hello\nworld\n'
      }
    })

    const patchText = [
      '--- a/doc.tex',
      '+++ b/doc.tex',
      '@@ -1,2 +1,2 @@',
      '-hello',
      '+HELLO',
      ' world',
      ''
    ].join('\n')

    await applyUnifiedPatchToFile({ baseDir: 'repo', targetPath: 'doc.tex', patchText })
    const updated = await readFile('repo/doc.tex', 'utf8')
    expect(updated).toBe('HELLO\nworld\n')
    mockFs.restore()
  })

  test('fails when hunk cannot match', async () => {
    mockFs({
      repo: {
        'doc.tex': 'a\nb\n'
      }
    })

    const patchText = [
      '--- a/doc.tex',
      '+++ b/doc.tex',
      '@@ -1,2 +1,2 @@',
      '-NOTFOUND',
      '+X',
      ' b',
      ''
    ].join('\n')

    await expect(applyUnifiedPatchToFile({ baseDir: 'repo', targetPath: 'doc.tex', patchText })).rejects.toThrow(
      /patch application failed/
    )
    const unchanged = await readFile('repo/doc.tex', 'utf8')
    expect(unchanged).toBe('a\nb\n')
    mockFs.restore()
  })
})

