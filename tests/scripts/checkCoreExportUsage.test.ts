import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { analyzeCoreExportUsage } from '../../scripts/check-core-export-usage.js'

function writeFile(rootDir: string, relativePath: string, content: string): void {
  const fullPath = path.join(rootDir, relativePath)
  mkdirSync(path.dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content)
}

describe('check-core-export-usage', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('reports exports that are not imported by non-core runtime src files', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'seed-core-export-usage-'))
    tempDirs.push(rootDir)

    writeFile(
      rootDir,
      'src/core/entities/example.ts',
      [
        'export const Used = 1',
        'export const Unused = 2'
      ].join('\n')
    )
    writeFile(
      rootDir,
      'src/app.ts',
      [
        "import { Used } from './core/entities/example.js'",
        'void Used'
      ].join('\n')
    )

    const result = analyzeCoreExportUsage(rootDir)
    const unusedNames = result.unusedExports.map((item) => item.name)

    expect(unusedNames).toEqual(['Unused'])
  })

  test('ignores test-only imports when deciding whether an export is unused', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'seed-core-export-usage-'))
    tempDirs.push(rootDir)

    writeFile(rootDir, 'src/core/entities/example.ts', 'export const TestOnly = 1')
    writeFile(rootDir, 'src/app.ts', 'export const app = true')
    writeFile(rootDir, 'tests/example.test.ts', "import { TestOnly } from '../src/core/entities/example.js'\nvoid TestOnly")

    const result = analyzeCoreExportUsage(rootDir)
    const unusedNames = result.unusedExports.map((item) => item.name)

    expect(unusedNames).toEqual(['TestOnly'])
  })

  test('does not report exports when the module is imported via namespace in runtime src', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'seed-core-export-usage-'))
    tempDirs.push(rootDir)

    writeFile(rootDir, 'src/core/entities/example.ts', 'export const KeepMe = 1')
    writeFile(
      rootDir,
      'src/app.ts',
      [
        "import * as Example from './core/entities/example.js'",
        'void Example'
      ].join('\n')
    )

    const result = analyzeCoreExportUsage(rootDir)
    expect(result.unusedExports).toEqual([])
  })
})
