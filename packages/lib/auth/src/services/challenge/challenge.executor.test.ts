import { describe, it } from '@effect/vitest'
import { Clock, Effect, Layer, Redacted, TestClock } from 'effect'
import { expect } from 'vitest'
import { ChallengeService, ChallengeServiceConfig, ChallengeServiceLive } from './challenge.executor.js'

const TTL_MILLIS = 300_000

const layer = ChallengeServiceLive.pipe(
  Layer.provide(Layer.succeed(
    ChallengeServiceConfig,
    ChallengeServiceConfig.of({
      signingKey: Redacted.make(new Uint8Array(32).fill(42)),
      ttlMillis: TTL_MILLIS,
      getRandomValues: (array) => crypto.getRandomValues(array),
    }),
  )),
)

describe('ChallengeServiceLive', () => {
  it.layer(layer)((it) => {
    it.effect('Should_Consume_When_FreshlyMinted', () =>
      Effect.gen(function*() {
        const service = yield* ChallengeService
        const challenge = yield* service.makeChallenge()

        yield* service.consumeChallenge(challenge)
      }))

    it.effect('Should_AcceptSameTokenTwice_When_BothConsumedWithinTtl', () =>
      Effect.gen(function*() {
        const service = yield* ChallengeService
        const challenge = yield* service.makeChallenge()

        yield* service.consumeChallenge(challenge)
        yield* TestClock.adjust(TTL_MILLIS)
        yield* service.consumeChallenge(challenge)
      }))

    it.effect('Should_RejectAsInauthentic_When_TamperedAfterMinting', () =>
      Effect.gen(function*() {
        const service = yield* ChallengeService
        const challenge = yield* service.makeChallenge()
        challenge[0] = challenge[0]! ^ 0xff

        const error = yield* service.consumeChallenge(challenge).pipe(Effect.flip)

        expect(error.reason).toBe('inauthentic')
      }))

    it.effect('Should_RejectAsExpired_When_ConsumedPastTtl', () =>
      Effect.gen(function*() {
        const service = yield* ChallengeService
        const challenge = yield* service.makeChallenge()
        yield* TestClock.adjust(TTL_MILLIS + 1)

        const error = yield* service.consumeChallenge(challenge).pipe(Effect.flip)

        expect(error.reason).toBe('expired')
      }))

    it.effect('Should_RejectAsMalformed_When_BufferIsNotAToken', () =>
      Effect.gen(function*() {
        const service = yield* ChallengeService
        const now = yield* Clock.currentTimeMillis

        const error = yield* service.consumeChallenge(new Uint8Array(16).fill(now & 0xff)).pipe(Effect.flip)

        expect(error.reason).toBe('malformed')
      }))
  })
})
