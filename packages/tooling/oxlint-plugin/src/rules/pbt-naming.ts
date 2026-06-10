// Stryker disable all
import { defineRule } from '@oxlint/plugins'
import type { Context, ESTree } from '@oxlint/plugins'

export type Options = []
export type MessageIds =
  | 'invalidSegments'
  | 'invalidScopeSymbol'
  | 'emptyDomain'
  | 'domainLeaksDAMP'
  | 'invalidPredicateSymbol'

// Format: [Symbol][Scope]_[Domain]_[Symbol][Predicate]
// ∀x_DecodeEncode_=x     — "for all x, encode-decode equals x"
// ≤ab_Sort_≤fg           — "ordered input produces ordered output"
// →Shipped_Cancel_⊥      — "shipped implies cancellation is impossible"

const SCOPE_SYMBOLS = new Set(['∀', '∃', '→', '¬', '≤', '≥'])
const PREDICATE_SYMBOLS = new Set([
  '≡',
  '≠',
  '=',
  '≤',
  '≥',
  '∈',
  '⊆',
  '⊇',
  '→',
  '¬',
  '∘',
  '∩',
  '∪',
  '⊥',
])

const PASCAL_CASE = /^[A-Z][a-z][a-zA-Z0-9]*$/

export const pbtNaming = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce mathematical notation naming for property-based tests (it.prop / it.effect.prop). ' +
        'Format: [Symbol][Scope]_[Domain]_[Symbol][Predicate] ' +
        '(e.g., ∀x_DecodeEncode_=x, →Shipped_Cancel_⊥)',
    },
    schema: [],
    messages: {
      invalidSegments: 'Expected: exactly 2 underscores in PBT name ([Scope]_[Domain]_[Predicate]). ' +
        'Actual: name "{{actual}}" has {{count}} separator(s). ' +
        "If this isn't a universal invariant, delete the test. " +
        'Otherwise use format [Symbol][Scope]_[Domain]_[Symbol][Predicate] (e.g., ∀x_DecodeEncode_=x).',
      invalidScopeSymbol: 'Expected: scope symbol (∀ ∃ → ¬ ≤ ≥) at start of name. ' +
        'Actual: name "{{actual}}" starts with "{{firstChar}}". ' +
        "If this isn't a universal invariant, delete the test. " +
        'Otherwise prefix with a scope symbol, e.g., ∀, ∃, →, ¬, ≤, ≥.',
      emptyDomain: 'Expected: non-empty PascalCase domain between the two underscores in "{{actual}}". ' +
        "If this isn't a universal invariant, delete the test. " +
        'Otherwise add the domain concept, e.g., ∀x_DecodeEncode_=x.',
      domainLeaksDAMP: 'Expected: invariant domain without scenario language. ' +
        'Actual: domain "{{domain}}" contains "{{word}}" — this describes one case, not a universal law. ' +
        'Delete this test. It is not a property. Find the actual invariant and write that instead.',
      invalidPredicateSymbol: 'Expected: predicate symbol (≡ ≠ = ≤ ≥ ∈ ⊆ → ∘ ∩ ∪ ⊥) at start of last segment. ' +
        'Actual: name "{{actual}}" ends with "{{firstChar}}". ' +
        "If this isn't a universal invariant, delete the test. " +
        'Otherwise use a predicate symbol, e.g., =, ≡, ≠, ≤, ∈, ⊆, ⊥.',
    },
  },
  create(context: Context) {
    // Stryker restore all
    const isPropCall = (node: ESTree.CallExpression): boolean => {
      let foundProp = false
      let current: ESTree.Node = node.callee

      while (current.type === 'MemberExpression') {
        if (current.property.type === 'Identifier' && current.property.name === 'prop') {
          foundProp = true
        }
        current = current.object
      }

      return (
        foundProp &&
        current.type === 'Identifier' &&
        isTestIdentifier(current.name)
      )
    }

    const isTestIdentifier = (name: string): boolean => name === 'it' || name === 'test'

    const extractTestName = (
      node: ESTree.CallExpression,
    ): string | undefined => {
      const firstArg = node.arguments[0]
      if (!firstArg) {
        return undefined
      }

      if (firstArg.type === 'Literal') {
        return String(firstArg.value)
      }

      if (firstArg.type !== 'TemplateLiteral') {
        return undefined
      }
      if (firstArg.quasis.length !== 1) {
        return undefined
      }
      return firstArg.quasis[0]?.value.cooked ?? undefined
    }

    const parseSegments = (
      name: string,
    ): { scopeSegment: string; domainSegment: string; predicateSegment: string } | null => {
      const parts = name.split('_')
      if (parts.length !== 3) {
        return null
      }
      return {
        scopeSegment: parts[0]!,
        domainSegment: parts[1]!,
        predicateSegment: parts[2]!,
      }
    }

    return {
      CallExpression(node: ESTree.CallExpression) {
        if (!isPropCall(node)) {
          return
        }

        const testName = extractTestName(node)
        if (!testName) {
          return
        }

        const segments = parseSegments(testName)
        if (!segments) {
          context.report({
            node: node.arguments[0]!,
            messageId: 'invalidSegments',
            data: {
              actual: testName,
              count: testName.split('_').length - 1,
            },
          })
          return
        }

        const { scopeSegment, domainSegment, predicateSegment } = segments

        const scopeSymbol = scopeSegment.charAt(0)
        if (!SCOPE_SYMBOLS.has(scopeSymbol)) {
          context.report({
            node: node.arguments[0]!,
            messageId: 'invalidScopeSymbol',
            data: { actual: testName, firstChar: scopeSymbol },
          })
          return
        }

        if (!PASCAL_CASE.test(domainSegment)) {
          context.report({
            node: node.arguments[0]!,
            messageId: 'emptyDomain',
            data: { actual: testName },
          })
          return
        }

        const dampMatch = /When|Should/.exec(domainSegment)
        if (dampMatch) {
          context.report({
            node: node.arguments[0]!,
            messageId: 'domainLeaksDAMP',
            data: { domain: domainSegment, word: dampMatch[0] },
          })
          return
        }

        const predicateSymbol = predicateSegment.charAt(0)
        if (!PREDICATE_SYMBOLS.has(predicateSymbol)) {
          context.report({
            node: node.arguments[0]!,
            messageId: 'invalidPredicateSymbol',
            data: { actual: testName, firstChar: predicateSymbol },
          })
          return
        }
      },
    }
  },
})
