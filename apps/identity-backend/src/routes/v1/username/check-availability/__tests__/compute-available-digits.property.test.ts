import { UsernameDigits } from '#root/schema/mod.js'
import { it } from '@effect/vitest'
import { HashSet, Schema as S } from 'effect'
import { describe, expect } from 'vitest'
import { computeAvailableDigits } from '../compute-available-digits.js'

describe('computeAvailableDigits', () => {
  const digitV1Set = new Set(
    Array.from({ length: 100 }, (_, i) => i.toString().padStart(2, '0')),
  )

  const toV1AllocatedNumbers = (digits: HashSet.HashSet<UsernameDigits>): number[] =>
    Array.from(HashSet.values(digits))
      .filter((d) => d !== '00' && digitV1Set.has(d))
      .map((d) => parseInt(d, 10))

  const allocatedDigitsArb = S.HashSet(UsernameDigits).pipe(
    S.filter((digits) => HashSet.size(digits) <= 20),
  )

  it.prop(
    '∀x_NeverContainZeroOrAllocatedDigits_≠x',
    [allocatedDigitsArb],
    ([allocatedDigits]) => {
      const result = computeAvailableDigits(allocatedDigits)

      expect.soft(result, 'digit 0 never present').not.toContain(0)

      const allocatedAsNumbers = toV1AllocatedNumbers(allocatedDigits)
      if (allocatedAsNumbers.length > 0) {
        expect.soft(result, 'allocated digits excluded').toEqual(
          expect.not.arrayContaining(allocatedAsNumbers),
        )
      }
    },
  )

  it.prop(
    '∀x_ReturnCorrectCount_=x',
    [allocatedDigitsArb],
    ([allocatedDigits]) => {
      const v1Allocated = toV1AllocatedNumbers(allocatedDigits)
      const expectedCount = 99 - v1Allocated.length

      const result = computeAvailableDigits(allocatedDigits)

      expect.soft(result, `99 - ${v1Allocated.length} allocated = ${expectedCount} available`).toHaveLength(
        expectedCount,
      )
    },
  )

  it.prop(
    '∀x_HaveAllDigitsInRange1To99_∈x',
    [allocatedDigitsArb],
    ([allocatedDigits]) => {
      const result = computeAvailableDigits(allocatedDigits)

      for (const digit of result) {
        expect.soft(digit, `digit ${digit} in valid range`).toBeGreaterThanOrEqual(1)
        expect.soft(digit, `digit ${digit} in valid range`).toBeLessThanOrEqual(99)
      }
    },
  )
})
