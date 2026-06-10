import { describe, expect, it } from 'vitest'
import { formatBigIntToDecimal } from '../token-math.js'

describe('formatBigIntToDecimal', () => {
  const DOT_DECIMALS = 10
  const KSM_DECIMALS = 12
  const ONE_DOT_IN_PLANCKS = 10n ** BigInt(DOT_DECIMALS)
  const ONE_KSM_IN_PLANCKS = 10n ** BigInt(KSM_DECIMALS)

  it('Should_CorrectlyFormatTokenAmounts_When_ValidDecimals', () => {
    const dotFormatter = formatBigIntToDecimal(DOT_DECIMALS)
    const oneDotTwoThreeDot = dotFormatter(12345678901234n)
    const oneDot = dotFormatter(ONE_DOT_IN_PLANCKS)
    const oneHundredthDot = dotFormatter(ONE_DOT_IN_PLANCKS / 100n)
    expect(oneDotTwoThreeDot).toBeCloseTo(1234.57, 2)
    expect(oneDot).toBe(1)
    expect(oneHundredthDot).toBe(0.01)

    const ksmFormatter = formatBigIntToDecimal(KSM_DECIMALS)
    const oneDotTwoThreeKsm = ksmFormatter(1234567890123n)
    const oneKsm = ksmFormatter(ONE_KSM_IN_PLANCKS)
    const oneHundredthKsm = ksmFormatter(ONE_KSM_IN_PLANCKS / 100n)
    expect(oneDotTwoThreeKsm).toBeCloseTo(1.23, 2)
    expect(oneKsm).toBe(1)
    expect(oneHundredthKsm).toBe(0.01)
  })

  it('Should_HandleZeroAndDust_When_MinimalAmounts', () => {
    const dotFormatter = formatBigIntToDecimal(DOT_DECIMALS)
    const zeroDot = dotFormatter(0n)
    const smallestDotUnit = dotFormatter(1n)
    expect(zeroDot).toBe(0)
    expect(smallestDotUnit).toBeGreaterThan(0)
    expect(smallestDotUnit).toBeLessThan(0.000001)

    const ksmFormatter = formatBigIntToDecimal(KSM_DECIMALS)
    const zeroKsm = ksmFormatter(0n)
    const smallestKsmUnit = ksmFormatter(1n)
    expect(zeroKsm).toBe(0)
    expect(smallestKsmUnit).toBeGreaterThan(0)
    expect(smallestKsmUnit).toBeLessThan(0.000001)
  })

  it('Should_HandleLargeAmounts_When_BigNumbers', () => {
    const dotFormatter = formatBigIntToDecimal(DOT_DECIMALS)
    const hundredMillionDot = dotFormatter(ONE_DOT_IN_PLANCKS * 100000000n)
    expect(hundredMillionDot).toBeCloseTo(100000000, 0)

    const ksmFormatter = formatBigIntToDecimal(KSM_DECIMALS)
    const billionKsm = ksmFormatter(ONE_KSM_IN_PLANCKS * 1000000000n)
    expect(billionKsm).toBeCloseTo(1000000000, 0)
  })
})
