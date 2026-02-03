import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { runCli } from '../src/cli/run.js'
import type { IO } from '../src/cli/io.js'

function createTestIO(opts: { stdinText?: string }) {
  const out: string[] = []
  const err: string[] = []
  const io: IO = {
    readStdin: async () => opts.stdinText ?? '',
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t)
  }
  return { io, out, err }
}

describe('CLI smoke', () => {
  test('create task -> propose patch -> accept patch -> replay log', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'coauthor-'))
    await writeFile(join(baseDir, 'doc.tex'), 'hello\nworld\n', 'utf8')

    const io1 = createTestIO({})
    await runCli({ argv: ['task', 'create', 'Hello'], baseDir, io: io1.io })
    const taskId = io1.out.join('').trim()
    expect(taskId.length).toBeGreaterThan(5)

    const patchText = [
      '--- a/doc.tex',
      '+++ b/doc.tex',
      '@@ -1,2 +1,2 @@',
      '-hello',
      '+HELLO',
      ' world',
      ''
    ].join('\n')

    const io2 = createTestIO({ stdinText: patchText })
    await runCli({ argv: ['patch', 'propose', taskId, 'doc.tex'], baseDir, io: io2.io })
    const proposalId = io2.out.join('').trim()
    expect(proposalId.length).toBeGreaterThan(5)

    const io3 = createTestIO({})
    await runCli({ argv: ['patch', 'accept', taskId, 'latest'], baseDir, io: io3.io })
    expect(io3.out.join('')).toMatch(/applied/)

    const updated = await readFile(join(baseDir, 'doc.tex'), 'utf8')
    expect(updated).toBe('HELLO\nworld\n')

    const io4 = createTestIO({})
    await runCli({ argv: ['log', 'replay', taskId], baseDir, io: io4.io })
    const replay = io4.out.join('')
    expect(replay).toMatch(/TaskCreated/)
    expect(replay).toMatch(/PatchProposed/)
    expect(replay).toMatch(/PatchApplied/)
  })

  test('task create --file/--lines + feedback post', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'coauthor-'))
    await writeFile(join(baseDir, 'doc.tex'), 'hello\nworld\n', 'utf8')

    const io1 = createTestIO({})
    await runCli({
      argv: ['task', 'create', 'Improve', '--file', 'doc.tex', '--lines', '1-2'],
      baseDir,
      io: io1.io
    })
    const taskId = io1.out.join('').trim()

    const io2 = createTestIO({})
    await runCli({ argv: ['feedback', 'post', taskId, '--text', 'LGTM'], baseDir, io: io2.io })
    expect(io2.out.join('')).toMatch(/posted/)

    const io5 = createTestIO({})
    await runCli({ argv: ['log', 'replay', taskId], baseDir, io: io5.io })
    const replay = io5.out.join('')
    expect(replay).toMatch(/UserFeedbackPosted/)
  })
})
