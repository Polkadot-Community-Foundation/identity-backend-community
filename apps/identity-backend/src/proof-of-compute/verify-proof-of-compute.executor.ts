import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { timingSafeEqual } from '@std/crypto/timing-safe-equal'
import { Clock, Duration, Effect, Either, Match, Ref } from 'effect'
import { Schema as S } from 'effect'
import { ProofOfComputeConfig } from './proof-of-compute.config.js'
import {
  ChecksumMismatchError,
  ChecksumPreimage,
  InsufficientDifficultyError,
  ProofExpiredError,
  ProofReplayedError,
  type SessionId,
  type Solution,
  type VerificationError,
  WorkPreimage,
} from './proof-of-compute.schema.js'
import { type SpentPuzzles, tryConsume } from './spent-puzzles.store.js'

const checksumPreimage = S.decodeSync(ChecksumPreimage)
const workPreimage = S.decodeSync(WorkPreimage)

const checksumBytes = (secret: Uint8Array, sessionId: SessionId, timestamp: number, difficulty: number): Uint8Array =>
  hmac(sha256, secret, checksumPreimage({ sessionId, timestamp, difficulty }))

const leadingZeroBits = (sessionId: SessionId, timestamp: number, counter: number): number => {
  const digest = sha256(workPreimage({ sessionId, timestamp, counter }))
  return Math.clz32(new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false))
}

const requireThat = <E>(holds: boolean, onViolation: () => E): Either.Either<void, E> =>
  Match.value(holds).pipe(
    Match.when(true, () => Either.void),
    Match.when(false, () => Either.left(onViolation())),
    Match.exhaustive,
  )

interface VerifyProof {
  readonly solution: Solution
  readonly secret: Uint8Array
  readonly nowMs: number
  readonly ttlMs: number
  readonly clockSkewMs: number
}

const verifyProof = (input: VerifyProof): Either.Either<SessionId, VerificationError> => {
  const { solution } = input
  const checksumOk = timingSafeEqual(
    checksumBytes(input.secret, solution.sessionId, solution.timestamp, solution.difficulty),
    hexToBytes(solution.checksum),
  )
  const withinTtl = input.nowMs - solution.timestamp <= input.ttlMs + input.clockSkewMs
  const workOk = leadingZeroBits(solution.sessionId, solution.timestamp, solution.counter) >= solution.difficulty

  return Either.gen(function*() {
    yield* requireThat(checksumOk, () => new ChecksumMismatchError())
    yield* requireThat(withinTtl, () => new ProofExpiredError())
    yield* requireThat(workOk, () => new InsufficientDifficultyError())
    return solution.sessionId
  })
}

export interface VerifyProofRequest {
  readonly solution: Solution
  readonly secret: Uint8Array
}

export const verifyProofOfCompute = Effect.fn('poc.verify_proof')(function*(
  state: Ref.Ref<SpentPuzzles>,
  request: VerifyProofRequest,
) {
  const config = yield* ProofOfComputeConfig
  if (config.enabled === false) {
    return yield* Effect.dieMessage('ProofOfComputeConfig enabled=false reached verifyProofOfCompute')
  }

  const { solution } = request
  const ttlMs = Duration.toMillis(config.ttl)
  const clockSkewMs = Duration.toMillis(config.clockSkew)

  const nowMs = yield* Clock.currentTimeMillis
  const sessionId = yield* verifyProof({
    solution,
    secret: request.secret,
    nowMs,
    ttlMs,
    clockSkewMs,
  })

  const consumed = yield* tryConsume(state, solution.sessionId, new Date(solution.timestamp + ttlMs + clockSkewMs))
  if (!consumed) {
    return yield* Effect.fail(new ProofReplayedError())
  }

  return sessionId
})

/* Stryker disable all */
if (import.meta.vitest) {
  const { describe, it } = await import('@effect/vitest')
  const { expect } = await import('vitest')
  const { Arbitrary, FastCheck: fc } = await import('effect')
  const { bytesToHex } = await import('@noble/hashes/utils.js')
  const { SessionId, Solution } = await import('./proof-of-compute.schema.js')

  const TTL = 5_000 as const
  const SKEW = 2_000 as const
  const REF_SECRET = new TextEncoder().encode('vector-secret')
  const REF_SESSION = SessionId.make('1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed')
  const REF_TS = 1_700_000_000_000 as const
  const REF_DIFF = 4 as const

  const checkExpired = (r: Either.Either<unknown, VerificationError>): boolean =>
    Either.match(r, {
      onLeft: (e) => Match.value(e).pipe(Match.tag('PocExpired', () => true), Match.orElse(() => false)),
      onRight: () => false,
    })

  const checkChecksumMismatch = (r: Either.Either<unknown, VerificationError>): boolean =>
    Either.match(r, {
      onLeft: (e) => Match.value(e).pipe(Match.tag('PocChecksumMismatch', () => true), Match.orElse(() => false)),
      onRight: () => false,
    })

  const checkInsufficientDifficulty = (r: Either.Either<unknown, VerificationError>): boolean =>
    Either.match(r, {
      onLeft: (e) => Match.value(e).pipe(Match.tag('PocInsufficientDifficulty', () => true), Match.orElse(() => false)),
      onRight: () => false,
    })

  const solved = (secret: Uint8Array, solution: Solution): Solution =>
    Solution.make({
      sessionId: solution.sessionId,
      timestamp: solution.timestamp,
      difficulty: solution.difficulty,
      counter: (() => {
        let c = 0
        while (leadingZeroBits(solution.sessionId, solution.timestamp, c) < solution.difficulty) {
          c += 1
        }
        return c
      })(),
      checksum: bytesToHex(checksumBytes(secret, solution.sessionId, solution.timestamp, solution.difficulty)),
    })

  const secretArb = fc.uint8Array({ minLength: 16, maxLength: 48 })

  // Solving costs ~2^difficulty hashes; the schema's full 1–32 range would hang the fuzzer for minutes.
  // Verification only checks `leadingZeroBits >= difficulty`, so tightening the real field exercises
  // every branch while keeping each solve trivial. Derived from the schema, never a parallel primitive.
  const SolvableDifficulty = Solution.fields.difficulty.pipe(S.lessThanOrEqualTo(8))

  const solvedArb = fc.record({
    secret: secretArb,
    sessionId: Arbitrary.make(SessionId),
    timestamp: Arbitrary.make(Solution.fields.timestamp),
    difficulty: Arbitrary.make(SolvableDifficulty),
  }).map(({ difficulty, secret, sessionId, timestamp }) => ({
    secret,
    solution: solved(secret, Solution.make({ sessionId, timestamp, difficulty, counter: 0, checksum: '0'.repeat(64) })),
  }))

  describe('checksumBytes', () => {
    it('Should_MatchFrozenVector_When_GivenReferenceInputs', () => {
      expect(bytesToHex(checksumBytes(REF_SECRET, REF_SESSION, REF_TS, REF_DIFF))).toBe(
        'c8828951fd6c123fdbf6501f111d27dd3f260839344a7370e0dd8f20e2c40482' as const,
      )
      expect(leadingZeroBits(REF_SESSION, REF_TS, 0)).toBe(3)
      expect(leadingZeroBits(REF_SESSION, REF_TS, 12_345)).toBe(0)
    })

    it('Should_MatchFrozenVector_When_DifficultyIsOne', () => {
      expect(bytesToHex(checksumBytes(REF_SECRET, REF_SESSION, REF_TS, 1))).toBe(
        'a12353d5a46eedc52548b7238969fb8142c9712104d0eebe43ed2721b6afca8e' as const,
      )
    })

    it('Should_MatchFrozenVector_When_DifficultyIsThirtyTwo', () => {
      expect(bytesToHex(checksumBytes(REF_SECRET, REF_SESSION, REF_TS, 32))).toBe(
        'cf86554e900aae407d9ff6af17e22e29dee6eca816bb713ffe28d8827c856a24' as const,
      )
    })

    it.prop(
      '∀x_Hex64_=64',
      [secretArb, SessionId, Solution.fields.timestamp, Solution.fields.difficulty],
      ([secret, sessionId, timestamp, difficulty]) => {
        const hex = bytesToHex(checksumBytes(secret, sessionId, timestamp, difficulty))
        return hex.length === 64 && /^[0-9a-f]{64}$/.test(hex)
      },
    )

    it.prop(
      '∀x_Deterministic_=x',
      [secretArb, SessionId, Solution.fields.timestamp, Solution.fields.difficulty],
      ([secret, sessionId, timestamp, difficulty]) => {
        const a = bytesToHex(checksumBytes(secret, sessionId, timestamp, difficulty))
        const b = bytesToHex(checksumBytes(secret, sessionId, timestamp, difficulty))
        return a === b
      },
    )
  })

  describe('verifyProof', () => {
    it.prop(
      '∀x_VerifyFresh_∈Right',
      [solvedArb],
      ([{ secret, solution }]) =>
        Either.isRight(verifyProof({ solution, secret, nowMs: solution.timestamp, ttlMs: TTL, clockSkewMs: SKEW })),
    )

    it.prop(
      '∀x_VerifyBoundary_∈Right',
      [solvedArb],
      ([{ secret, solution }]) =>
        Either.isRight(
          verifyProof({
            solution,
            secret,
            nowMs: solution.timestamp + TTL + SKEW,
            ttlMs: TTL,
            clockSkewMs: SKEW,
          }),
        ),
    )

    it.prop(
      '∀x_Expired_∈Left',
      [solvedArb],
      ([{ secret, solution }]) =>
        checkExpired(
          verifyProof({
            solution,
            secret,
            nowMs: solution.timestamp + TTL + SKEW + 1,
            ttlMs: TTL,
            clockSkewMs: SKEW,
          }),
        ),
    )

    it.prop(
      '∀x_ChecksumMismatch_∈Left',
      [solvedArb],
      ([{ secret, solution }]) => {
        const bad = Solution.make({
          sessionId: solution.sessionId,
          timestamp: solution.timestamp,
          difficulty: solution.difficulty,
          counter: solution.counter,
          checksum: bytesToHex(
            checksumBytes(new Uint8Array([...secret, 1]), solution.sessionId, solution.timestamp, solution.difficulty),
          ),
        })
        return checkChecksumMismatch(
          verifyProof({ solution: bad, secret, nowMs: solution.timestamp, ttlMs: TTL, clockSkewMs: SKEW }),
        )
      },
    )

    it.prop(
      '∀x_Undersolved_∈Left',
      [solvedArb],
      ([{ secret, solution }]) => {
        let c = 0
        while (leadingZeroBits(solution.sessionId, solution.timestamp, c) >= solution.difficulty) {
          c += 1
        }
        const bad = Solution.make({
          sessionId: solution.sessionId,
          timestamp: solution.timestamp,
          difficulty: solution.difficulty,
          counter: c,
          checksum: solution.checksum,
        })
        return checkInsufficientDifficulty(
          verifyProof({ solution: bad, secret, nowMs: solution.timestamp, ttlMs: TTL, clockSkewMs: SKEW }),
        )
      },
    )
  })
}
