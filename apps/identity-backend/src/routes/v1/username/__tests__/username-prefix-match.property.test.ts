import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { classifySearchPrefix } from '../username-prefix-match.js'

describe('classifySearchPrefix', () => {
  const prefixWithoutDot = fc.string().map((s) => s.replaceAll('.', ''))
  const prefixWithDot = fc.tuple(fc.string(), fc.string()).map(([head, tail]) => `${head}.${tail}`)

  it('Should_ReturnLiteOnly_When_PrefixContainsADot', () => {
    fc.assert(
      fc.property(prefixWithDot, (prefix) => {
        expect(classifySearchPrefix(prefix), `dotted prefix "${prefix}" is lite-only`).toBe('LiteOnly')
      }),
    )
  })

  it('Should_ReturnLiteAndFull_When_PrefixHasNoDot', () => {
    fc.assert(
      fc.property(prefixWithoutDot, (prefix) => {
        expect(classifySearchPrefix(prefix), `dotless prefix "${prefix}" matches lite and full`).toBe('LiteAndFull')
      }),
    )
  })
})
