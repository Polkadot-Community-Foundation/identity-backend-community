import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatBigIntToDecimal } from '../token-math.js'

describe('formatBigIntToDecimal', () => {
  const DOT_DECIMALS = 10
  const KSM_DECIMALS = 12

  it('Should_MaintainOrderOfMagnitude_When_DecimalFormatting', () => {
    const supportedDecimals = fc.constantFrom(DOT_DECIMALS, KSM_DECIMALS)
    const reasonableTokenAmount = fc.bigInt({ min: 1n, max: 1000000000000000n })

    fc.assert(
      fc.property(supportedDecimals, reasonableTokenAmount, (decimals, amount) => {
        const formatter = formatBigIntToDecimal(decimals)
        const formattedAmount = formatter(amount)
        const formattedTenTimes = formatter(amount * 10n)

        expect(Number.isFinite(formattedAmount)).toBe(true)
        expect(formattedAmount).toBeGreaterThanOrEqual(0)

        const tenPercentMargin = 0.1
        expect(formattedTenTimes).toBeGreaterThan(formattedAmount * (10 - tenPercentMargin))
        expect(formattedTenTimes).toBeLessThan(formattedAmount * (10 + tenPercentMargin))
      }),
    )
  })
})
