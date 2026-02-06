import { applyPatch, parsePatch } from 'diff'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, normalize, resolve } from 'node:path'

function normalizePatchFileName(name: string | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (trimmed === '/dev/null') return null
  return trimmed.replace(/^([ab])\//, '')
}

type ParsedDiff = ReturnType<typeof parsePatch>[number]

function matchesTarget(patch: ParsedDiff, targetPath: string): boolean {
  const oldName = normalizePatchFileName(patch.oldFileName)
  const newName = normalizePatchFileName(patch.newFileName)
  const targetNorm = normalize(targetPath)
  const targetBase = basename(targetNorm)
  return (
    (oldName !== null && (normalize(oldName) === targetNorm || basename(oldName) === targetBase)) ||
    (newName !== null && (normalize(newName) === targetNorm || basename(newName) === targetBase))
  )
}

export async function applyUnifiedPatchToFile(opts: {
  baseDir: string
  targetPath: string
  patchText: string
}): Promise<{ absolutePath: string; updatedText: string }> {
  const { baseDir, targetPath, patchText } = opts
  const absolutePath = resolve(baseDir, targetPath)

  const patches = parsePatch(patchText)
  const patch =
    patches.length === 1 ? patches[0] : patches.find((p) => matchesTarget(p, targetPath)) ?? null

  if (!patch) {
    throw new Error(
      patches.length === 0
        ? 'patch parsing failed: no file diff hunks found'
        : `patch parsing failed: contains multiple files and cannot match targetPath=${targetPath}`
    )
  }

  const originalText = await readFile(absolutePath, 'utf8')
  const updatedText = applyPatch(originalText, patch, { autoConvertLineEndings: true })
  if (updatedText === false) {
    throw new Error('patch application failed: hunks do not match target file')
  }

  await writeFile(absolutePath, updatedText, 'utf8')
  return { absolutePath, updatedText }
}
