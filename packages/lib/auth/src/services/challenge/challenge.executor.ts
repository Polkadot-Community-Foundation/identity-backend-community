import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { timingSafeEqual } from '@std/crypto/timing-safe-equal'
import { Clock, Context, Effect, Layer, Metric, Redacted } from 'effect'
import { NONCE_BYTES } from './challenge.schema.js'
import type { ChallengeRejectedError } from './challenge.schema.js'
import { mintChallenge, type Sign, verifyChallenge } from './challenge.workflow.js'

const issuedCounter = Metric.counter('auth.challenge.issued', {
  description: 'Challenge tokens minted',
})
const rejectedCounter = Metric.counter('auth.challenge.rejected', {
  description: 'Challenge verifications rejected, by reason',
})
const consumedCounter = Metric.counter('auth.challenge.consumed', {
  description: 'Challenge tokens accepted (authentic and within TTL)',
})

export class ChallengeService extends Context.Tag('ChallengeService')<ChallengeService, {
  makeChallenge: () => Effect.Effect<Uint8Array>
  consumeChallenge: (_: Uint8Array) => Effect.Effect<void, ChallengeRejectedError>
}>() {}

export class ChallengeServiceConfig extends Context.Tag('ChallengeServiceConfig')<ChallengeServiceConfig, {
  readonly signingKey: Redacted.Redacted<Uint8Array>
  readonly ttlMillis: number
  readonly getRandomValues: typeof crypto.getRandomValues
}>() {}

export const ChallengeServiceLive = Layer.effect(
  ChallengeService,
  Effect.gen(function*() {
    const config = yield* ChallengeServiceConfig
    const key = Redacted.value(config.signingKey)
    const sign: Sign = (message) => hmac(sha256, key, message)

    const makeChallenge = Effect.fn('auth.makeChallenge')(function*() {
      const issuedAtMillis = yield* Clock.currentTimeMillis
      const nonce = yield* Effect.sync(() => config.getRandomValues(new Uint8Array(NONCE_BYTES)))
      const token = mintChallenge(sign, nonce, issuedAtMillis)
      yield* Metric.increment(issuedCounter)
      return token
    })

    const consumeChallenge = Effect.fn('auth.consumeChallenge')(function*(challenge: Uint8Array) {
      const nowMillis = yield* Clock.currentTimeMillis
      yield* Effect.tapError(
        verifyChallenge(sign, timingSafeEqual, nowMillis, config.ttlMillis, challenge),
        (error) =>
          Effect.annotateCurrentSpan('auth.challenge.reject_reason', error.reason).pipe(
            Effect.zipRight(Metric.increment(Metric.tagged(rejectedCounter, 'reason', error.reason))),
          ),
      ).pipe(
        Effect.tap(() => Metric.increment(consumedCounter)),
      )
    })

    return { makeChallenge, consumeChallenge } satisfies ChallengeService['Type']
  }),
)
