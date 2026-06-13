import { Effect, HashMap, Option, SynchronizedRef } from 'effect'
import { SubmissionKey } from './submission-key.schema.js'

export interface SubmissionSerializer {
  readonly serialize: <A, E, R>(
    key: SubmissionKey,
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}

export const makeSubmissionSerializer: Effect.Effect<SubmissionSerializer> = Effect.gen(function*() {
  const semaphores = yield* SynchronizedRef.make(HashMap.empty<SubmissionKey, Effect.Semaphore>())

  const getOrCreateSemaphore = (key: SubmissionKey): Effect.Effect<Effect.Semaphore> =>
    Effect.flatMap(
      Effect.makeSemaphore(1),
      (candidate) =>
        SynchronizedRef.modifyEffect(semaphores, (registered) =>
          Option.match(HashMap.get(registered, key), {
            onSome: (existing) => Effect.succeed([existing, registered] as const),
            onNone: () => Effect.succeed([candidate, HashMap.set(registered, key, candidate)] as const),
          })),
    )

  const serialize: SubmissionSerializer['serialize'] = (key, operation) =>
    getOrCreateSemaphore(key).pipe(Effect.flatMap((perKey) => perKey.withPermits(1)(operation)))

  return { serialize }
})

// Stryker disable all
if (import.meta.vitest) {
  const { assert, describe, it } = await import('@effect/vitest')
  const { Deferred, Duration, Exit, Fiber, Ref, Schema: S } = await import('effect')

  const keyOf = S.decodeSync(SubmissionKey)
  const PEOPLE_ALICE = keyOf({ chain: 'people', account: '0xalice' })
  const PEOPLE_BOB = keyOf({ chain: 'people', account: '0xbob' })

  describe('SubmissionSerializer', () => {
    it.live('Should_RunOneAtATime_When_SameKey', () =>
      Effect.gen(function*() {
        const { serialize } = yield* makeSubmissionSerializer
        const active = yield* Ref.make(0)
        const peak = yield* Ref.make(0)
        const release = yield* Deferred.make<void>()

        const tracked = Effect.gen(function*() {
          const now = yield* Ref.updateAndGet(active, (n) => n + 1)
          yield* Ref.update(peak, (p) => Math.max(p, now))
          yield* Deferred.await(release)
          yield* Ref.update(active, (n) => n - 1)
        })

        const first = yield* Effect.fork(serialize(PEOPLE_ALICE, tracked))
        const second = yield* Effect.fork(serialize(PEOPLE_ALICE, tracked))
        yield* Effect.sleep(Duration.millis(30))
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)

        assert.strictEqual(yield* Ref.get(peak), 1)
      }))

    it.live('Should_RunConcurrently_When_DistinctKeys', () =>
      Effect.gen(function*() {
        const { serialize } = yield* makeSubmissionSerializer
        const release = yield* Deferred.make<void>()
        const aliceStarted = yield* Deferred.make<void>()
        const bobStarted = yield* Deferred.make<void>()

        const alice = yield* Effect.fork(
          serialize(
            PEOPLE_ALICE,
            Deferred.succeed(aliceStarted, undefined).pipe(Effect.zipRight(Deferred.await(release))),
          ),
        )
        const bob = yield* Effect.fork(
          serialize(PEOPLE_BOB, Deferred.succeed(bobStarted, undefined).pipe(Effect.zipRight(Deferred.await(release)))),
        )

        yield* Deferred.await(aliceStarted)
        yield* Deferred.await(bobStarted)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(alice)
        yield* Fiber.join(bob)
      }))

    it.live('Should_ReleasePermit_When_OperationFails', () =>
      Effect.gen(function*() {
        const { serialize } = yield* makeSubmissionSerializer
        const failed = yield* serialize(PEOPLE_ALICE, Effect.fail('boom')).pipe(Effect.exit)
        assert.strictEqual(Exit.isFailure(failed), true)

        const recovered = yield* serialize(PEOPLE_ALICE, Effect.succeed(42))
        assert.strictEqual(recovered, 42)
      }))

    it.live('Should_ReleasePermit_When_Interrupted', () =>
      Effect.gen(function*() {
        const { serialize } = yield* makeSubmissionSerializer
        const started = yield* Deferred.make<void>()
        const blocked = yield* Effect.fork(
          serialize(PEOPLE_ALICE, Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never))),
        )
        yield* Deferred.await(started)
        yield* Fiber.interrupt(blocked)

        const recovered = yield* serialize(PEOPLE_ALICE, Effect.succeed(42))
        assert.strictEqual(recovered, 42)
      }))
  })
}
// Stryker restore all
