import { afterEach, describe, it, vi } from '@effect/vitest'
import { Duration, Effect, Exit, Fiber, Option, Ref, Schedule, TestClock } from 'effect'
import { expect } from 'vitest'
import { withSupervision } from '../daemon-spec.js'

const TEST_BACKOFF: Schedule.Schedule<Duration.Duration> = Schedule.exponential(Duration.millis(10)).pipe(
  Schedule.upTo(Duration.millis(50)),
)
const TEST_COOLDOWN = Duration.millis(100)
const TEST_MAX_RESTARTS = 2

describe('withSupervision', () => {
  const onRestart = vi.fn(() => Effect.void)
  const onExhausted = vi.fn(() => Effect.void)

  afterEach(() => {
    vi.clearAllMocks()
  })

  it.effect('Should_ReturnImmediately_When_BodySucceedsOnFirstAttempt', () =>
    Effect.gen(function*() {
      const result = yield* Effect.succeed('ok').pipe(
        withSupervision({
          name: 'happy',
          maxRestarts: TEST_MAX_RESTARTS,
          backoff: TEST_BACKOFF,
          cooldown: TEST_COOLDOWN,
          onRestart,
          onExhausted,
        }),
      )
      expect.soft(result).toBe('ok')
      expect.soft(onRestart).not.toHaveBeenCalled()
      expect.soft(onExhausted).not.toHaveBeenCalled()
    }))

  it.effect('Should_FireTier1HookAndRecover_When_BodyRecoversBeforeBudgetExhausted', () =>
    Effect.gen(function*() {
      const attempts = yield* Ref.make(0)
      const body = Effect.gen(function*() {
        const n = yield* Ref.updateAndGet(attempts, (x) => x + 1)
        return n === 1 ? yield* Effect.fail(new Error('transient')) : ('ok' as const)
      })

      const fiber = yield* body.pipe(
        withSupervision({
          name: 'transient',
          maxRestarts: TEST_MAX_RESTARTS,
          backoff: TEST_BACKOFF,
          cooldown: TEST_COOLDOWN,
          onRestart,
          onExhausted,
        }),
        Effect.fork,
      )

      yield* TestClock.adjust(Duration.seconds(1))
      const exit = yield* Fiber.await(fiber)

      expect.soft(Exit.isSuccess(exit) ? exit.value : null).toBe('ok')
      expect.soft(yield* Ref.get(attempts), 'body ran twice total').toBe(2)
      expect.soft(onRestart).toHaveBeenCalledTimes(1)
      expect.soft(onExhausted).not.toHaveBeenCalled()
    }))

  it.effect('Should_EnterTier2CooldownAndRecover_When_Tier1Exhausts', () =>
    Effect.gen(function*() {
      const tier1Count = TEST_MAX_RESTARTS + 1
      const attempts = yield* Ref.make(0)
      const body = Effect.gen(function*() {
        const n = yield* Ref.updateAndGet(attempts, (x) => x + 1)
        return n <= tier1Count ? yield* Effect.fail(new Error(`fail-${n}`)) : ('ok' as const)
      })

      const fiber = yield* body.pipe(
        withSupervision({
          name: 'exhaust-recover',
          maxRestarts: TEST_MAX_RESTARTS,
          backoff: TEST_BACKOFF,
          cooldown: TEST_COOLDOWN,
          onRestart,
          onExhausted,
        }),
        Effect.fork,
      )

      yield* TestClock.adjust(Duration.seconds(1))
      const exit = yield* Fiber.await(fiber)

      expect.soft(Exit.isSuccess(exit) ? exit.value : null).toBe('ok')
      expect.soft(yield* Ref.get(attempts), 'body ran tier-1 exhaust + one post-cooldown success').toBe(tier1Count + 1)
      expect.soft(onRestart).toHaveBeenCalledTimes(tier1Count)
      expect.soft(onExhausted).toHaveBeenCalledTimes(1)
    }))

  it.scoped('Should_NotTerminate_When_PermanentFailurePersistsAcrossCooldowns', () =>
    Effect.gen(function*() {
      const attempts = yield* Ref.make(0)
      const twoFullCycles = (TEST_MAX_RESTARTS + 1) * 2
      const cyclesReached = yield* Effect.makeLatch(false)

      const body = Effect.gen(function*() {
        const n = yield* Ref.updateAndGet(attempts, (x) => x + 1)
        if (n >= twoFullCycles) yield* cyclesReached.open
        return yield* Effect.fail(new Error(`fail-${n}`))
      })

      const fiber = yield* body.pipe(
        withSupervision({
          name: 'permanent',
          maxRestarts: TEST_MAX_RESTARTS,
          backoff: TEST_BACKOFF,
          cooldown: TEST_COOLDOWN,
          onExhausted,
        }),
        Effect.fork,
      )

      yield* TestClock.adjust(Duration.seconds(1))
      yield* cyclesReached.await

      const fiberPoll = yield* Fiber.poll(fiber)
      yield* Fiber.interrupt(fiber)

      expect.soft(Option.isNone(fiberPoll), 'fiber still running after 2 tier-2 cycles').toBe(true)
      expect.soft(onExhausted.mock.calls.length).toBeGreaterThanOrEqual(2)
    }))

  it.effect('Should_SupportDataFirstCalling_When_BodyPassedAsFirstArg', () =>
    Effect.gen(function*() {
      const result = yield* withSupervision(Effect.succeed('ok'), {
        name: 'data-first',
        maxRestarts: TEST_MAX_RESTARTS,
        backoff: TEST_BACKOFF,
        cooldown: TEST_COOLDOWN,
      })
      expect.soft(result).toBe('ok')
    }))
})
