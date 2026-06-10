import { CHALLENGE_TTL_SECONDS } from '#root/config.js'
import * as schema from '#root/db/schema.js'
import {
  ChallengeNotFoundError,
  ChallengeService,
  ConsumeChallengeError,
  PersistChallengeError,
} from '@identity-backend/auth/services'
import { DB } from '@identity-backend/db'
import { and, eq, gt } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, pipe } from 'effect'
import { encodeBase64 } from 'effect/Encoding'

export class ChallengeServiceLiveConfig extends Context.Tag('ChallengeServiceLiveConfig')<ChallengeServiceLiveConfig, {
  getRandomValues: typeof crypto.getRandomValues
  ttlSeconds: number
}>() {}

export const ChallengeServiceLiveWithoutDependencies = Layer.effect(
  ChallengeService,
  Effect.gen(function*() {
    const config = yield* ChallengeServiceLiveConfig
    const db = yield* DB

    const makeChallenge = (Effect.fn('auth.makeChallenge')(() =>
      Effect.sync(() => {
        const challenge = new Uint8Array(16)
        config.getRandomValues(challenge)

        return challenge
      })
    )) satisfies ChallengeService['Type']['makeChallenge']

    const consumeChallenge = Effect.fn('play_integrity.consumeChallenge')((challenge) =>
      Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        const threshold = new Date(now - config.ttlSeconds * 1000)

        const deleted = yield* pipe(
          Effect.tryPromise(() =>
            db.delete(schema.challenges)
              .where(and(
                eq(schema.challenges.id, encodeBase64(challenge)),
                gt(schema.challenges.createdAt, threshold),
              ))
              .returning()
          ),
          Effect.mapError((err) => ConsumeChallengeError.make({ cause: err })),
        )

        yield* Effect.annotateCurrentSpan({ 'challenge.type': 'play_integrity', 'db.operation': 'delete' })

        if (deleted.length === 0) {
          return yield* Effect.fail(ChallengeNotFoundError.make())
        }
      })
    ) satisfies ChallengeService['Type']['consumeChallenge']

    const persistChallenge = (Effect.fn('persistChallenge')(function*(challenge) {
      yield* Effect.tryPromise({
        try: () =>
          db.insert(schema.challenges)
            .values({ id: encodeBase64(challenge) }),
        catch: (cause) => PersistChallengeError.make({ cause }),
      })

      yield* Effect.annotateCurrentSpan({ 'challenge.type': 'play_integrity', 'db.operation': 'insert' })
    })) satisfies ChallengeService['Type']['persistChallenge']

    return {
      makeChallenge,
      consumeChallenge,
      persistChallenge,
    } satisfies ChallengeService['Type'] as ChallengeService['Type']
  }),
)

export const ChallengeServiceLive = ChallengeServiceLiveWithoutDependencies.pipe(
  Layer.provide(
    Layer.effect(
      ChallengeServiceLiveConfig,
      Effect.gen(function*() {
        const crypto = globalThis.crypto
        const ttlSeconds = yield* CHALLENGE_TTL_SECONDS

        return ChallengeServiceLiveConfig.of({
          getRandomValues: crypto.getRandomValues.bind(crypto),
          ttlSeconds,
        })
      }),
    ),
  ),
)
