import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Fiber, pipe, Stream, TestClock } from 'effect'
import type { TxEvent } from 'polkadot-api'
import { runTxFinalized, TxFinalizationError, TxInclusionTimeoutError } from '../tx-events.js'

const signed = (txHash: string): TxEvent => ({ type: 'signed', txHash } as TxEvent)

const broadcasted = (txHash: string): TxEvent => ({ type: 'broadcasted', txHash } as TxEvent)

const bestBlocksFound = (txHash: string): TxEvent => ({
  type: 'txBestBlocksState',
  txHash,
  found: true,
  ok: true,
  events: [],
  block: { hash: '0xblock', number: 1, index: 0 },
} as TxEvent)

const INCLUSION_TIMEOUT = Duration.seconds(5)
const FINALIZATION_TIMEOUT = Duration.seconds(70)

const watchUntilTimeout = (events: ReadonlyArray<TxEvent>) =>
  pipe(
    Stream.concat(Stream.fromIterable(events), Stream.never),
    runTxFinalized({ inclusionTimeout: INCLUSION_TIMEOUT, finalizationTimeout: FINALIZATION_TIMEOUT }),
    Effect.flip,
    Effect.fork,
  )

describe('runTxFinalized', () => {
  it.effect('Should_FailWithInclusionTimeout_When_TxNeverEntersBestBlock', () =>
    Effect.gen(function*() {
      const fiber = yield* watchUntilTimeout([signed('0xabc'), broadcasted('0xabc')])

      yield* TestClock.adjust(INCLUSION_TIMEOUT)

      expect(yield* Fiber.join(fiber)).toBeInstanceOf(TxInclusionTimeoutError)
    }))

  it.effect('Should_FailWithFinalizationError_When_IncludedTxNeverFinalizes', () =>
    Effect.gen(function*() {
      const fiber = yield* watchUntilTimeout([signed('0xabc'), broadcasted('0xabc'), bestBlocksFound('0xabc')])

      yield* TestClock.adjust(FINALIZATION_TIMEOUT)

      expect(yield* Fiber.join(fiber)).toBeInstanceOf(TxFinalizationError)
    }))
})
