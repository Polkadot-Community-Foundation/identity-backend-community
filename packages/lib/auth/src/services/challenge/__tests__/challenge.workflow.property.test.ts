import { describe, it } from '@effect/vitest'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { equals as bytesEquals } from '@std/bytes/equals'
import { Either } from 'effect'
import * as fc from 'fast-check'
import { expect } from 'vitest'
import { ChallengeRejectedError } from '../challenge.schema.js'
import { ChallengeVerified, mintChallenge, verifyChallenge } from '../challenge.workflow.js'

const TTL_MILLIS = 300_000

const keyArb = fc.uint8Array({ minLength: 1, maxLength: 64 })
const nonceArb = fc.uint8Array({ minLength: 16, maxLength: 16 })
const issuedAtArb = fc.integer({ min: 0, max: 2_000_000_000_000 })
const ageArb = fc.integer({ min: 0, max: TTL_MILLIS })

const signWith = (key: Uint8Array) => (message: Uint8Array) => hmac(sha256, key, message)

const rejectionReason = (
  result: Either.Either<ChallengeVerified, ChallengeRejectedError>,
): string | undefined => (Either.isLeft(result) ? result.left.reason : undefined)

describe('challenge workflow', () => {
  it.prop(
    '∀token_Authentic_≡VerifiedAtIssuedAt',
    [keyArb, nonceArb, issuedAtArb, ageArb],
    ([key, nonce, issuedAt, age]) => {
      const sign = signWith(key)
      const token = mintChallenge(sign, nonce, issuedAt)
      const result = verifyChallenge(sign, bytesEquals, issuedAt + age, TTL_MILLIS, token)

      return Either.isRight(result) && result.right.issuedAtMillis === issuedAt
    },
  )

  it.prop(
    '∀token_TamperedByte_≡Inauthentic',
    [keyArb, nonceArb, issuedAtArb, fc.nat({ max: 56 - 1 }), fc.integer({ min: 1, max: 255 })],
    ([key, nonce, issuedAt, index, delta]) => {
      const sign = signWith(key)
      const token = mintChallenge(sign, nonce, issuedAt)
      token[index] = (token[index]! ^ delta) & 0xff

      return rejectionReason(verifyChallenge(sign, bytesEquals, issuedAt, TTL_MILLIS, token)) === 'inauthentic'
    },
  )

  it.prop(
    '∀buffer_Forged_≡Inauthentic',
    [keyArb, fc.uint8Array({ minLength: 56, maxLength: 56 }), issuedAtArb],
    ([key, forged, now]) =>
      rejectionReason(verifyChallenge(signWith(key), bytesEquals, now, TTL_MILLIS, forged)) === 'inauthentic',
  )

  it.prop(
    '∀buffer_WrongLength_≡Malformed',
    [keyArb, fc.uint8Array({ maxLength: 128 }).filter((b) => b.length !== 56), issuedAtArb],
    ([key, wrongLength, now]) =>
      rejectionReason(verifyChallenge(signWith(key), bytesEquals, now, TTL_MILLIS, wrongLength)) === 'malformed',
  )

  it.prop(
    '∀key_Foreign_≡Left',
    [keyArb, keyArb, nonceArb, issuedAtArb],
    ([keyA, keyB, nonce, issuedAt]) => {
      const token = mintChallenge(signWith(keyA), nonce, issuedAt)
      const rejectedUnderB = Either.isLeft(verifyChallenge(signWith(keyB), bytesEquals, issuedAt, TTL_MILLIS, token))

      return bytesEquals(keyA, keyB) || rejectedUnderB
    },
  )

  describe('TTL boundaries', () => {
    const key = new Uint8Array(32).fill(9)
    const nonce = new Uint8Array(16).fill(5)
    const sign = signWith(key)
    const issuedAt = 1_700_000_000_000
    const token = mintChallenge(sign, nonce, issuedAt)
    const verifyAt = (now: number) => verifyChallenge(sign, bytesEquals, now, TTL_MILLIS, token)

    it('Should_VerifyAtIssuedAt_When_ConsumedInSameMillisecondAsIssued', () => {
      expect(verifyAt(issuedAt)).toEqual(Either.right(new ChallengeVerified({ issuedAtMillis: issuedAt })))
    })

    it('Should_VerifyAtIssuedAt_When_ConsumedExactlyAtTtlEdge', () => {
      expect(verifyAt(issuedAt + TTL_MILLIS)).toEqual(
        Either.right(new ChallengeVerified({ issuedAtMillis: issuedAt })),
      )
    })

    it('Should_RejectAsExpired_When_ConsumedOneMillisecondPastTtlEdge', () => {
      expect(verifyAt(issuedAt + TTL_MILLIS + 1)).toEqual(
        Either.left(new ChallengeRejectedError({ reason: 'expired' })),
      )
    })

    it('Should_VerifyDespiteClockSkew_When_NowIsBeforeIssuedAt', () => {
      expect(verifyAt(issuedAt - 5000)).toEqual(
        Either.right(new ChallengeVerified({ issuedAtMillis: issuedAt })),
      )
    })
  })

  it('Should_MintExactWireLayout_When_BuildingAChallenge', () => {
    const key = new Uint8Array(32).fill(7)
    const nonce = Uint8Array.from({ length: 16 }, (_unused, i) => i + 1)
    const issuedAt = 1_700_000_000_123
    const sign = signWith(key)

    const expectedSigned = new Uint8Array(24)
    expectedSigned.set(nonce, 0)
    new DataView(expectedSigned.buffer).setBigUint64(16, BigInt(issuedAt), false)
    const expected = new Uint8Array(56)
    expected.set(expectedSigned, 0)
    expected.set(hmac(sha256, key, expectedSigned), 24)

    const token = mintChallenge(sign, nonce, issuedAt)

    expect(token.length).toBe(56)
    expect(bytesEquals(token, expected)).toBe(true)
  })
})
