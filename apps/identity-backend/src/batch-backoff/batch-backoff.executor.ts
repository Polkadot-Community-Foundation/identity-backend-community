import { Context, Effect, Either, Match, Metric, Ref } from 'effect'
import { type BatchOutcome, type BatchSize, type BatchSizePolicy } from './batch-backoff.schema.js'
import { SettleBatchAttempt, settleBatchAttempt } from './batch-backoff.workflow.js'

// =============================================================================
// Dependencies
// =============================================================================

export class RecordBatchOutcomeDeps extends Context.Tag('RecordBatchOutcomeDeps')<
  RecordBatchOutcomeDeps,
  {
    readonly daemon: string
    readonly policy: BatchSizePolicy
    readonly size: Ref.Ref<BatchSize>
  }
>() {}

// =============================================================================
// Operation
// =============================================================================

const batchSizeGauge = Metric.gauge('app.daemon.batch_size', {
  description: 'Current reactive per-tick batch size for a batch daemon',
})
const settlementsCounter = Metric.counter('app.daemon.batch_backoff.settlements', {
  description: 'Batch attempt settlements by variant',
})

export const recordBatchOutcome = Effect.fn('batch_backoff.record_outcome')(
  function*(outcome: BatchOutcome) {
    const { daemon, policy, size } = yield* RecordBatchOutcomeDeps
    const settled = yield* Ref.modify(size, (current) => {
      const next = settleBatchAttempt(new SettleBatchAttempt({ policy, current, outcome }))
      return [next, Either.merge(next).size] as const
    })
    const settlement = Either.merge(settled)
    yield* Metric.update(Metric.tagged(batchSizeGauge, 'daemon', daemon), settlement.size)
    yield* Metric.increment(
      Metric.tagged(
        Metric.tagged(settlementsCounter, 'daemon', daemon),
        'settlement',
        settlement._tag,
      ),
    )
    yield* Match.value(settlement).pipe(
      Match.tag('BatchFaultedError', () => Effect.logWarning('batch-backoff.settled')),
      Match.tag('BatchThrottledError', () => Effect.logDebug('batch-backoff.settled')),
      Match.tag('BatchGrown', () => Effect.logDebug('batch-backoff.settled')),
      Match.tag('BatchSteady', () => Effect.logDebug('batch-backoff.settled')),
      Match.exhaustive,
    ).pipe(Effect.annotateLogs({
      'batch_backoff.daemon': daemon,
      'batch_backoff.outcome': outcome._tag,
      'batch_backoff.settlement': settlement._tag,
      'batch_backoff.size': settlement.size,
    }))
    return settled
  },
)
