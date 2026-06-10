#!/usr/bin/env node
/**
 * Parses effect/ParseResult's TypeScript source and dumps its public API
 * as a TOON-formatted markdown file.
 *
 * Usage: pnpm exec tsx scripts/dump-parse-result-api.ts
 * Output: .cursor/rules/effect-parse-result-public-api.mdc
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const SOURCE_PATH = path.join(
  REPO_ROOT,
  'repos',
  'effect',
  'packages',
  'effect',
  'src',
  'ParseResult.ts',
)
const OUTPUT_PATH = path.join(REPO_ROOT, '.cursor', 'rules', 'effect-parse-result-public-api.mdc')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ExportEntry {
  name: string
  kind: string
  since: string
  category: string
  signature: string
  description: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getJSDoc(node: ts.Node): ts.JSDoc | undefined {
  const jsDocTags = ts.getJSDocTags(node)
  if (jsDocTags.length > 0) {
    return ts.getJSDocCommentsAndTags(node)?.[0] as ts.JSDoc | undefined
  }
  return undefined
}

function getJSDocTagText(node: ts.Node, tagName: string): string {
  const tags = ts.getJSDocTags(node)
  for (const tag of tags) {
    if (tag.tagName.text === tagName) {
      return tag.comment?.toString()?.trim() ?? ''
    }
  }
  return ''
}

function getJSDocDescription(node: ts.Node): string {
  const jsdoc = getJSDoc(node)
  if (!jsdoc) return ''
  const comment = jsdoc.comment
  if (!comment) return ''
  const text = typeof comment === 'string' ? comment : comment.map((c) => c.getText?.() ?? '').join('')
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned.length > 120 ? cleaned.slice(0, 117) + '...' : cleaned
}

function isIgnored(node: ts.Node): boolean {
  const tags = ts.getJSDocTags(node)
  for (const tag of tags) {
    if (tag.tagName.text === 'ignore') return true
    if (tag.tagName.text === 'internal') return true
  }
  return false
}

function getFunctionSignature(node: ts.FunctionDeclaration | ts.MethodDeclaration): string {
  const name = node.name?.getText() ?? '(anonymous)'
  const typeParams = node.typeParameters
    ? `<${node.typeParameters.map((tp) => tp.getText()).join(', ')}>`
    : ''
  const params = node.parameters
    .map((p) => `${p.name.getText()}${p.questionToken ? '?' : ''}${p.type ? ': ' + p.type.getText() : ''}`)
    .join(', ')
  const returnType = node.type ? `: ${node.type.getText()}` : ''
  return `${name}${typeParams}(${params})${returnType}`
}

function getVariableSignature(node: ts.VariableDeclaration): string {
  const name = node.name.getText()
  const type = node.type ? `: ${node.type.getText()}` : ''
  const initializer = node.initializer
    ? getInitializerHint(node.initializer)
    : ''
  return `${name}${type}${initializer}`
}

function getInitializerHint(expr: ts.Expression): string {
  if (ts.isStringLiteralLike(expr)) return ` = "${expr.text}"`
  if (ts.isNumericLiteral(expr)) return ` = ${expr.text}`
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return ' = false'
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return ' = true'
  if (expr.kind === ts.SyntaxKind.NullKeyword) return ' = null'
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return ' = (...) => ...'
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression.getText()
    if (callee.length < 40) return ` = ${callee}(...)`
    return ' = (...)'
  }
  if (ts.isPropertyAccessExpression(expr)) return ` = ${expr.getText()}`
  if (ts.isIdentifier(expr)) return ` = ${expr.text}`
  return ' = ...'
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

interface ExtractedAPI {
  version: string
  exports: ExportEntry[]
}

function extractAPI(sourcePath: string): ExtractedAPI {
  const sourceText = fs.readFileSync(sourcePath, 'utf-8')
  const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true)

  const exports: ExportEntry[] = []

  // Walk all top-level statements
  for (const stmt of sourceFile.statements) {
    // export { ... } re-exports
    if (ts.isExportDeclaration(stmt)) {
      if (!stmt.exportClause) continue
      if (ts.isNamespaceExport(stmt.exportClause)) {
        // export * as X from "..."
        exports.push({
          name: stmt.exportClause.name.getText(),
          kind: 're-export',
          since: '',
          category: '',
          signature: `re-exports all from "${(stmt.moduleSpecifier as ts.StringLiteral)?.text ?? '?'}"`,
          description: '',
        })
        continue
      }
      // export { X, Y as Z }
      for (const spec of stmt.exportClause.elements) {
        const name = spec.name.getText()
        const alias = spec.propertyName?.getText()
        const since = getJSDocTagText(spec, 'since')
        const cat = getJSDocTagText(spec, 'category')
        const desc = getJSDocDescription(spec)
        if (isIgnored(spec)) continue
        exports.push({
          name,
          since,
          category: cat,
          description: desc,
          kind: 're-export',
          signature: alias && alias !== name ? `${alias} as ${name}` : name,
        })
      }
      continue
    }

    // export default ...
    if (ts.isExportAssignment(stmt)) {
      const expr = stmt.expression
      exports.push({
        name: 'default',
        kind: 'export',
        since: '',
        category: '',
        signature: expr.getText().slice(0, 80),
        description: '',
      })
      continue
    }

    // Skip non-export statements
    if (!isNodeExported(stmt)) continue

    // Handle `export declare namespace Foo { ... }` — extract inner exports
    if (ts.isModuleDeclaration(stmt) && stmt.body && ts.isModuleBlock(stmt.body)) {
      const nsName = stmt.name.getText()
      const since = getJSDocTagText(stmt, 'since')
      const cat = getJSDocTagText(stmt, 'category')
      const desc = getJSDocDescription(stmt)

      // Emit the namespace entry itself
      exports.push({
        name: nsName,
        kind: 'namespace',
        since,
        category: cat,
        description: desc,
        signature: '',
      })

      // Walk inner exports
      for (const innerStmt of stmt.body.statements) {
        if (!isNodeExported(innerStmt)) continue

        const innerSince = getJSDocTagText(innerStmt, 'since') || since
        const innerCat = getJSDocTagText(innerStmt, 'category') || cat
        const innerDesc = getJSDocDescription(innerStmt)

        if (innerSince && isIgnored(innerStmt)) continue

        if (ts.isTypeAliasDeclaration(innerStmt)) {
          exports.push({
            name: `${nsName}.${innerStmt.name.getText()}`,
            kind: 'type',
            since: innerSince,
            category: innerCat,
            signature: `type ${innerStmt.name.getText()}${
              innerStmt.typeParameters ? `<${innerStmt.typeParameters.map((tp) => tp.getText()).join(', ')}>` : ''
            } = ${innerStmt.type.getText().slice(0, 100)}`,
            description: innerDesc,
          })
        } else if (ts.isInterfaceDeclaration(innerStmt)) {
          exports.push({
            name: `${nsName}.${innerStmt.name.getText()}`,
            kind: 'interface',
            since: innerSince,
            category: innerCat,
            signature: `interface ${innerStmt.name.getText()}`,
            description: innerDesc,
          })
        } else if (ts.isFunctionDeclaration(innerStmt) && innerStmt.name) {
          exports.push({
            name: `${nsName}.${innerStmt.name.getText()}`,
            kind: 'function',
            since: innerSince,
            category: innerCat,
            signature: getFunctionSignature(innerStmt),
            description: innerDesc,
          })
        } else if (ts.isVariableStatement(innerStmt)) {
          for (const decl of innerStmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              exports.push({
                name: `${nsName}.${decl.name.getText()}`,
                kind: 'const',
                since: innerSince,
                category: innerCat,
                signature: getVariableSignature(decl),
                description: innerDesc,
              })
            }
          }
        }
      }
      continue
    }

    // Handle regular declarations
    if (ts.isFunctionDeclaration(stmt)) {
      const name = stmt.name?.getText() ?? ''
      if (!name) continue
      const since = getJSDocTagText(stmt, 'since')
      const cat = getJSDocTagText(stmt, 'category')
      if (!since || isIgnored(stmt)) continue
      exports.push({
        name,
        kind: 'function',
        since,
        category: cat,
        signature: getFunctionSignature(stmt),
        description: getJSDocDescription(stmt),
      })
      continue
    }

    if (ts.isInterfaceDeclaration(stmt)) {
      const name = stmt.name.getText()
      const since = getJSDocTagText(stmt, 'since')
      const cat = getJSDocTagText(stmt, 'category')
      if (!since || isIgnored(stmt)) continue
      exports.push({
        name,
        kind: 'interface',
        since,
        category: cat,
        signature: `interface ${name}${
          stmt.typeParameters ? `<${stmt.typeParameters.map((tp) => tp.getText()).join(', ')}>` : ''
        }`,
        description: getJSDocDescription(stmt),
      })
      continue
    }

    if (ts.isTypeAliasDeclaration(stmt)) {
      const name = stmt.name.getText()
      const since = getJSDocTagText(stmt, 'since')
      const cat = getJSDocTagText(stmt, 'category')
      if (!since || isIgnored(stmt)) continue
      exports.push({
        name,
        kind: 'type',
        since,
        category: cat,
        signature: `type ${name}${
          stmt.typeParameters ? `<${stmt.typeParameters.map((tp) => tp.getText()).join(', ')}>` : ''
        } = ${stmt.type.getText().slice(0, 120)}`,
        description: getJSDocDescription(stmt),
      })
      continue
    }

    if (ts.isClassDeclaration(stmt)) {
      const name = stmt.name?.getText() ?? ''
      if (!name) continue
      const since = getJSDocTagText(stmt, 'since')
      const cat = getJSDocTagText(stmt, 'category')
      if (!since || isIgnored(stmt)) continue
      exports.push({
        name,
        kind: 'class',
        since,
        category: cat,
        signature: `class ${name}${
          stmt.typeParameters ? `<${stmt.typeParameters.map((tp) => tp.getText()).join(', ')}>` : ''
        }`,
        description: getJSDocDescription(stmt),
      })
      continue
    }

    if (ts.isModuleDeclaration(stmt)) {
      const name = stmt.name.getText()
      const since = getJSDocTagText(stmt, 'since')
      const cat = getJSDocTagText(stmt, 'category')
      // Only include non-namespace modules that have @since
      if (!since || isIgnored(stmt)) continue
      exports.push({
        name,
        kind: 'namespace',
        since,
        category: cat,
        signature: `namespace ${name}`,
        description: getJSDocDescription(stmt),
      })
      continue
    }

    // VariableStatement (export const / export let)
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const name = decl.name.getText()
        const since = getJSDocTagText(stmt, 'since')
        const cat = getJSDocTagText(stmt, 'category')
        if (!since || isIgnored(stmt)) continue

        const kind =
          decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
            ? 'function'
            : decl.initializer && ts.isClassExpression(decl.initializer)
            ? 'class'
            : 'const'

        exports.push({
          name,
          kind,
          since,
          category: cat,
          signature: getVariableSignature(decl),
          description: getJSDocDescription(stmt),
        })
      }
      continue
    }
  }

  // Deduplicate by name (interface + namespace can share a name)
  const seen = new Set<string>()
  const unique = exports.filter((e) => {
    if (seen.has(e.name)) return false
    seen.add(e.name)
    return true
  })

  return {
    version: '3.10.0+',
    exports: unique.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// ---------------------------------------------------------------------------
// TOON Formatting
// ---------------------------------------------------------------------------

function formatAsToon(api: ExtractedAPI): string {
  const groups: Record<string, string[]> = {}
  for (const exp of api.exports) {
    const cat = exp.category || 'uncategorized'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(exp.name)
  }

  const cats = Object.keys(groups).sort()
  const entries = cats.map((cat) => {
    const names = groups[cat].sort()
    return `  "${cat}"[${names.length}]: ${names.join(',')}`
  })
  const content = `ParseResult:\n${entries.join('\n')}\n`
  const frontmatter = `---
description: Effect ParseResult API — all public exports
alwaysApply: true
---

# effect/ParseResult — \`import * as ParseResult from "effect/ParseResult"\`

${content}`
  return frontmatter
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function isNodeExported(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node)
    if (modifiers) {
      for (const mod of modifiers) {
        if (mod.kind === ts.SyntaxKind.ExportKeyword) return true
      }
    }
  }
  return false
}

function main() {
  console.log(`Parsing: ${SOURCE_PATH}`)

  if (!fs.existsSync(SOURCE_PATH)) {
    console.error(`Source not found at: ${SOURCE_PATH}`)
    process.exit(1)
  }

  const api = extractAPI(SOURCE_PATH)
  console.log(`Found ${api.exports.length} public exports`)

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })

  const toon = formatAsToon(api)
  fs.writeFileSync(OUTPUT_PATH, toon, 'utf-8')

  console.log(`Written to: ${OUTPUT_PATH}`)
  console.log(`File size: ${Buffer.byteLength(toon, 'utf-8')} bytes`)
}

main()
