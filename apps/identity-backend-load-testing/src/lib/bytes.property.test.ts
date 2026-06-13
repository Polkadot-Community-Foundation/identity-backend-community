import { describe, it } from '@effect/vitest'
import { Effect, FastCheck as fc } from 'effect'
import { expect } from 'vitest'
import { bytesToHex, concatBytes, hexToBytes, leadingZeroBitsOfHexDigest, uint64BigEndian } from './bytes'

const hexDigest = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 1, maxLength: 32 })
  .map((bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(''))

function leadingZeroBitsOracle(hex: string): number {
  const binary = hex.split('').map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('')
  const firstOne = binary.indexOf('1')
  return firstOne === -1 ? binary.length : firstOne
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

describe('bytes', () => {
  it.effect.prop(
    '∀b_HexCodec_=Bytes',
    [fc.uint8Array({ maxLength: 64 })],
    ([bytes]) => Effect.succeed(bytesEqual(hexToBytes(bytesToHex(bytes)), bytes)),
    { fastCheck: { numRuns: 200 } },
  )

  it.effect.prop(
    '∀d_LeadingZeroBits_=Oracle',
    [hexDigest],
    ([hex]) => Effect.succeed(leadingZeroBitsOfHexDigest(hex) === leadingZeroBitsOracle(hex)),
    { fastCheck: { numRuns: 400 } },
  )

  it.effect.prop(
    '∀a_ConcatBytes_=SumLength',
    [fc.array(fc.uint8Array({ maxLength: 16 }), { maxLength: 8 })],
    ([arrays]) => Effect.succeed(concatBytes(...arrays).length === arrays.reduce((sum, a) => sum + a.length, 0)),
    { fastCheck: { numRuns: 200 } },
  )

  it('Should_CountEveryBit_When_DigestIsAllZero', () => {
    expect(leadingZeroBitsOfHexDigest('0'.repeat(64))).toBe(256)
  })

  it('Should_ExceedThirtyTwoBits_When_ZerosRunPastFirstWord', () => {
    expect(leadingZeroBitsOfHexDigest(`00000000${'1'.padEnd(56, '0')}`)).toBe(35)
  })

  it('Should_ReturnZero_When_FirstNibbleIsSet', () => {
    expect(leadingZeroBitsOfHexDigest('f'.repeat(64))).toBe(0)
  })

  it('Should_EncodeEightBigEndianBytes_When_GivenSmallValue', () => {
    expect([...uint64BigEndian(1)]).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
  })

  it('Should_SplitAcrossHighWord_When_ValueExceedsThirtyTwoBits', () => {
    expect([...uint64BigEndian(0x1_0000_0000)]).toEqual([0, 0, 0, 1, 0, 0, 0, 0])
  })
})
