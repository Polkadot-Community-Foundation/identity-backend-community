import { differenceInSeconds } from 'date-fns/differenceInSeconds'
import { Clock, Context, Effect, HashMap, Layer, Option, pipe, Ref, Schema as S } from 'effect'
import { dual } from 'effect/Function'

export class TokenBucketRateLimiterConfig extends Context.Reference<TokenBucketRateLimiterConfig>()(
  'TokenBucketRateLimiterConfig',
  {
    defaultValue: () => ({
      bucketSize: 10,
      tokensPerSec: 1,
    }),
  },
) {}

export namespace TokenBucketRateLimiter {
  export interface TryConsumeConfig {
    readonly bucketSize: number
    readonly tokensPerSec: number
  }
  export interface Service {
    readonly tryConsume: (
      fingerprint: readonly string[],
      config?: TryConsumeConfig,
    ) => Effect.Effect<boolean>
  }
}

const make = Effect.gen(function*() {
  const config = yield* TokenBucketRateLimiterConfig
  const state = yield* Ref.make(HashMap.empty<string, BucketState>())

  const tryConsume: TokenBucketRateLimiter.Service['tryConsume'] = (fingerprint, overrideConfig) =>
    Effect.gen(function*() {
      const now = new Date(yield* Clock.currentTimeMillis)
      const key = fingerprint.join('|')
      const { bucketSize, tokensPerSec } = overrideConfig ?? config

      return yield* Ref.modify(state, (buckets) => {
        const bucket = pipe(
          HashMap.get(buckets, key),
          Option.getOrElse(() => BucketState.make({ tokens: bucketSize, lastRefill: now })),
        )

        const refilled = pipe(
          bucket,
          refillBucket(RefillOptions.make({ tokensPerSec, bucketSize, now })),
        )
        const [allowed, remaining] = consumeToken(refilled)
        return [allowed, HashMap.set(buckets, key, remaining)] as const
      })
    })

  return TokenBucketRateLimiter.of({ tryConsume })
})

export class TokenBucketRateLimiter extends Context.Tag('TokenBucketRateLimiter')<
  TokenBucketRateLimiter,
  TokenBucketRateLimiter.Service
>() {
  static readonly Default = Layer.effect(TokenBucketRateLimiter, make)
}

class BucketState extends S.Class<BucketState>('BucketState')({
  tokens: S.Number.pipe(S.nonNegative(), S.finite()),
  lastRefill: S.ValidDateFromSelf,
}) {}

class RefillOptions extends S.Class<RefillOptions>('RefillOptions')({
  tokensPerSec: S.Number.pipe(S.positive(), S.finite()),
  bucketSize: S.Number.pipe(S.int(), S.greaterThanOrEqualTo(1)),
  now: S.ValidDateFromSelf,
}) {}

const refillBucket = dual<
  (options: RefillOptions) => (bucket: BucketState) => BucketState,
  (bucket: BucketState, options: RefillOptions) => BucketState
>(2, (bucket, options) => {
  const elapsedSec = Math.max(0, differenceInSeconds(options.now, bucket.lastRefill))
  const refilled = Math.min(options.bucketSize, bucket.tokens + elapsedSec * options.tokensPerSec)
  return BucketState.make({ tokens: refilled, lastRefill: options.now })
})

const consumeToken = (bucket: BucketState): [consumed: boolean, remaining: BucketState] => {
  if (bucket.tokens < 1) {
    return [false, bucket] as const
  }
  return [true, BucketState.make({ tokens: bucket.tokens - 1, lastRefill: bucket.lastRefill })] as const
}

// Stryker disable all
if (import.meta.vitest) {
  const { describe, it } = await import('@effect/vitest')

  describe('refillBucket', () => {
    it.prop(
      '∀x_RefillTokensBoundedCalledWithOptions_=x',
      [BucketState, RefillOptions],
      ([bucket, options]) => {
        const refilled = refillBucket(bucket, options)
        return (
          refilled.tokens <= options.bucketSize &&
          refilled.lastRefill.getTime() === options.now.getTime()
        )
      },
    )
  })

  describe('consumeToken', () => {
    it.prop(
      '∀x_DecrementOrRejectConsuming_=x',
      [BucketState, S.ValidDateFromSelf],
      ([bucket, otherDate]) => {
        const emptyBucket = BucketState.make({ tokens: 0, lastRefill: otherDate })
        const [emptyConsumed, emptyRemaining] = consumeToken(emptyBucket)
        const [consumed, remaining] = consumeToken(bucket)
        const expectedConsumed = bucket.tokens >= 1
        const expectedTokens = expectedConsumed ? bucket.tokens - 1 : bucket.tokens
        return (
          emptyConsumed === false &&
          emptyRemaining.tokens === 0 &&
          consumed === expectedConsumed &&
          remaining.tokens === expectedTokens &&
          remaining.lastRefill.getTime() === bucket.lastRefill.getTime() &&
          emptyRemaining.lastRefill.getTime() === otherDate.getTime()
        )
      },
    )
  })
}
// Stryker restore all
