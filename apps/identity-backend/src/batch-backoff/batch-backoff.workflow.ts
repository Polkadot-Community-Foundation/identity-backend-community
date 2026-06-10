import { Either, Match, Schema as S } from 'effect'
import { BatchOutcome, BatchSize, BatchSizePolicy } from './batch-backoff.schema.js'

// =============================================================================
// Command
// =============================================================================

export class SettleBatchAttempt extends S.TaggedClass<SettleBatchAttempt>()('SettleBatchAttempt', {
  policy: BatchSizePolicy,
  current: BatchSize,
  outcome: BatchOutcome,
}) {}

// =============================================================================
// Decision and error variants
// =============================================================================

const BatchSettlementTypeId: unique symbol = Symbol.for('@app/batch-backoff/BatchSettlement')
type BatchSettlementTypeId = typeof BatchSettlementTypeId

export class BatchGrown extends S.TaggedClass<BatchGrown>()('BatchGrown', {
  from: BatchSize,
  size: BatchSize,
}) {
  readonly [BatchSettlementTypeId] = BatchSettlementTypeId
}
export class BatchSteady extends S.TaggedClass<BatchSteady>()('BatchSteady', {
  size: BatchSize,
}) {
  readonly [BatchSettlementTypeId] = BatchSettlementTypeId
}
export class BatchThrottledError extends S.TaggedError<BatchThrottledError>()('BatchThrottledError', {
  from: BatchSize,
  size: BatchSize,
}) {
  readonly [BatchSettlementTypeId] = BatchSettlementTypeId
}
export class BatchFaultedError extends S.TaggedError<BatchFaultedError>()('BatchFaultedError', {
  size: BatchSize,
}) {
  readonly [BatchSettlementTypeId] = BatchSettlementTypeId
}

export const BatchAccepted = S.Union(BatchGrown, BatchSteady)
export type BatchAccepted = S.Schema.Type<typeof BatchAccepted>

export const BatchRejected = S.Union(BatchThrottledError, BatchFaultedError)
export type BatchRejected = S.Schema.Type<typeof BatchRejected>

// =============================================================================
// Decision
// =============================================================================

const grow = (policy: BatchSizePolicy, current: BatchSize): BatchAccepted => {
  const result = Math.min(policy.max, current + policy.increaseStep)
  const size = BatchSize.make(Math.max(1, Math.trunc(result)))
  return Match.value(size > current).pipe(
    Match.when(true, () => new BatchGrown({ from: current, size })),
    Match.when(false, () => new BatchSteady({ size: current })),
    Match.exhaustive,
  )
}

const throttle = (policy: BatchSizePolicy, current: BatchSize): BatchThrottledError => {
  const result = current * policy.decreaseFactor
  const size = BatchSize.make(Math.max(1, Math.trunc(result)))
  return new BatchThrottledError({
    from: current,
    size,
  })
}

export const settleBatchAttempt = (
  command: SettleBatchAttempt,
): Either.Either<BatchAccepted, BatchRejected> =>
  Match.value(command.outcome).pipe(
    Match.tag('Succeeded', () => Either.right(grow(command.policy, command.current))),
    Match.tag('ResourceExhausted', () => Either.left(throttle(command.policy, command.current))),
    Match.tag('OtherFailure', () => Either.left(new BatchFaultedError({ size: command.current }))),
    Match.exhaustive,
  )
