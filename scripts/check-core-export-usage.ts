import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

type ExportSymbol = {
  filePath: string
  line: number
  name: string
}

type AnalysisResult = {
  exportSymbols: ExportSymbol[]
  unusedExports: ExportSymbol[]
}

type ImportUsage = {
  namedImports: Map<string, number>
  namespaceImportedFiles: Set<string>
}

function walkFiles(rootDir: string, predicate: (filePath: string) => boolean): string[] {
  const stack = [rootDir]
  const output: string[] = []

  while (stack.length > 0) {
    const currentDir = stack.pop()!
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (predicate(fullPath)) {
        output.push(fullPath)
      }
    }
  }

  return output.sort()
}

function getLineNumber(sourceFile: ts.SourceFile, node: ts.Node): number {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return position.line + 1
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return Boolean(modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function parseSourceFile(filePath: string): ts.SourceFile {
  const content = readFileSync(filePath, 'utf8')
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function collectExportSymbols(coreFiles: string[]): ExportSymbol[] {
  const exportSymbols: ExportSymbol[] = []

  for (const filePath of coreFiles) {
    const sourceFile = parseSourceFile(filePath)

    for (const statement of sourceFile.statements) {
      if (!hasExportModifier(statement)) {
        continue
      }

      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) {
            continue
          }
          exportSymbols.push({
            filePath,
            line: getLineNumber(sourceFile, declaration.name),
            name: declaration.name.text
          })
        }
        continue
      }

      if (
        ts.isFunctionDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)
      ) {
        if (!statement.name) {
          continue
        }
        exportSymbols.push({
          filePath,
          line: getLineNumber(sourceFile, statement.name),
          name: statement.name.text
        })
        continue
      }

      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          exportSymbols.push({
            filePath,
            line: getLineNumber(sourceFile, element),
            name: element.name.text
          })
        }
      }
    }
  }

  return exportSymbols
}

function resolveCoreImportTarget(importerPath: string, moduleSpecifier: string, coreRoot: string): string | null {
  if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
    return null
  }

  const unresolved = path.resolve(path.dirname(importerPath), moduleSpecifier)
  const candidates = new Set<string>()

  candidates.add(unresolved)
  candidates.add(`${unresolved}.ts`)
  candidates.add(`${unresolved}.tsx`)
  candidates.add(path.join(unresolved, 'index.ts'))

  if (moduleSpecifier.endsWith('.js') || moduleSpecifier.endsWith('.mjs') || moduleSpecifier.endsWith('.cjs')) {
    candidates.add(unresolved.replace(/\.(mjs|cjs|js)$/u, '.ts'))
    candidates.add(unresolved.replace(/\.(mjs|cjs|js)$/u, '.tsx'))
  }

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate)
    if (!existsSync(normalized)) {
      continue
    }
    if (normalized.startsWith(coreRoot)) {
      return normalized
    }
  }

  return null
}

function collectImportUsage(runtimeFiles: string[], coreRoot: string): ImportUsage {
  const namedImports = new Map<string, number>()
  const namespaceImportedFiles = new Set<string>()

  for (const filePath of runtimeFiles) {
    const sourceFile = parseSourceFile(filePath)
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) {
        continue
      }

      if (!ts.isStringLiteral(statement.moduleSpecifier)) {
        continue
      }

      const moduleSpecifier = statement.moduleSpecifier.text
      const targetFile = resolveCoreImportTarget(filePath, moduleSpecifier, coreRoot)
      if (!targetFile) {
        continue
      }

      if (statement.importClause.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings)) {
        namespaceImportedFiles.add(targetFile)
      }

      if (!statement.importClause.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) {
        continue
      }

      for (const element of statement.importClause.namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text
        const key = `${targetFile}::${importedName}`
        namedImports.set(key, (namedImports.get(key) ?? 0) + 1)
      }
    }
  }

  return { namedImports, namespaceImportedFiles }
}

function isTypeScriptFile(filePath: string): boolean {
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
    return false
  }
  return !filePath.endsWith('.d.ts')
}

export function analyzeCoreExportUsage(repoRoot: string): AnalysisResult {
  const srcRoot = path.join(repoRoot, 'src')
  const coreRoot = path.join(srcRoot, 'core')

  const coreFiles = walkFiles(coreRoot, isTypeScriptFile)
  const runtimeFiles = walkFiles(srcRoot, (filePath) => {
    if (!isTypeScriptFile(filePath)) {
      return false
    }
    return !filePath.startsWith(coreRoot)
  })

  const exportSymbols = collectExportSymbols(coreFiles)
  const importUsage = collectImportUsage(runtimeFiles, coreRoot)

  const unusedExports = exportSymbols.filter((symbol) => {
    if (importUsage.namespaceImportedFiles.has(symbol.filePath)) {
      return false
    }
    const key = `${symbol.filePath}::${symbol.name}`
    return !importUsage.namedImports.has(key)
  })

  return {
    exportSymbols,
    unusedExports
  }
}

function toRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/gu, '/')
}

export function runCli(argv: readonly string[] = process.argv.slice(2)): number {
  const rootFlagIndex = argv.indexOf('--root')
  const repoRoot =
    rootFlagIndex >= 0 && argv[rootFlagIndex + 1]
      ? path.resolve(argv[rootFlagIndex + 1]!)
      : process.cwd()

  const result = analyzeCoreExportUsage(repoRoot)
  if (result.unusedExports.length === 0) {
    console.log(`No unused exports found in src/core (${result.exportSymbols.length} exports scanned).`)
    return 0
  }

  console.error('Unused core exports detected (no non-core runtime src importer):')
  for (const symbol of result.unusedExports) {
    const relativePath = toRelativePath(repoRoot, symbol.filePath)
    console.error(`- ${relativePath}:${symbol.line} ${symbol.name}`)
  }
  return 1
}

const isMainModule =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  process.exitCode = runCli()
}
