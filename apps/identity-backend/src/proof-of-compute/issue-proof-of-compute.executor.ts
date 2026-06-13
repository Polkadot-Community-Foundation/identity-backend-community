import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Clock, Effect, Schema as S } from 'effect'
import { ChecksumPreimage, Puzzle, SessionId } from './proof-of-compute.schema.js'

const checksumPreimage = S.decodeSync(ChecksumPreimage)

const checksumHex = (secret: Uint8Array, sessionId: SessionId, timestamp: number, difficulty: number): string =>
  bytesToHex(hmac(sha256, secret, checksumPreimage({ sessionId, timestamp, difficulty })))

export interface IssueProofRequest {
  readonly secret: Uint8Array
  readonly difficulty: number
}

export const issueProofOfCompute = Effect.fn('poc.issue_proof')(function*(request: IssueProofRequest) {
  const timestamp = yield* Clock.currentTimeMillis
  const sessionId = yield* Effect.sync(() => SessionId.make(crypto.randomUUID()))

  return Puzzle.make({
    sessionId,
    timestamp,
    difficulty: request.difficulty,
    checksum: checksumHex(request.secret, sessionId, timestamp, request.difficulty),
  })
})

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('issueChecksum (private)', () => {
    it('Should_MatchFrozenVector_When_GivenReferenceInputs', () => {
      const secret = new TextEncoder().encode('vector-secret')
      const sessionId = SessionId.make('1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed')
      expect(checksumHex(secret, sessionId, 1_700_000_000_000, 4)).toBe(
        'c8828951fd6c123fdbf6501f111d27dd3f260839344a7370e0dd8f20e2c40482' as const,
      )
    })
  })
}
