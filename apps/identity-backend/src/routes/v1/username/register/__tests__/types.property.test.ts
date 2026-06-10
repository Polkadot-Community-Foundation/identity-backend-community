import { fuzz } from '@traversable/zod-test'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PreferredDigitsSchema } from '../types.js'

describe('PreferredDigitsSchema', () => {
  const generator = fuzz(PreferredDigitsSchema)

  it('Should_AlwaysProduceTwoDigitStrings_When_GeneratingValidData', () => {
    fc.assert(
      fc.property(generator, (data) => {
        expect(data.length, 'Generated data must be exactly 2 characters').toBe(2)
      }),
    )
  })

  it('Should_NeverProduce00_When_GeneratingValidData', () => {
    fc.assert(
      fc.property(generator, (data) => {
        expect(data, 'Generated data must not be reserved value 00').not.toBe('00')
      }),
    )
  })

  it('Should_AlwaysProduceValuesInRange01To99_When_GeneratingValidData', () => {
    fc.assert(
      fc.property(generator, (data) => {
        const num = parseInt(data, 10)
        expect.soft(num, 'Parsed value must be >= 1').toBeGreaterThanOrEqual(1)
        expect.soft(num, 'Parsed value must be <= 99').toBeLessThanOrEqual(99)
      }),
    )
  })
})
