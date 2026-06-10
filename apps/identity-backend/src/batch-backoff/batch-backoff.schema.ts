import { Schema as S } from 'effect'

// =============================================================================
// Value objects
// =============================================================================

export const BatchSize = S.Int.pipe(S.greaterThanOrEqualTo(1), S.brand('BatchSize'))
export type BatchSize = S.Schema.Type<typeof BatchSize>

export const DecreaseFactor = S.Number.pipe(
  S.greaterThan(0),
  S.lessThan(1),
  S.brand('DecreaseFactor'),
)
export type DecreaseFactor = S.Schema.Type<typeof DecreaseFactor>

export const IncreaseStep = S.Int.pipe(S.greaterThanOrEqualTo(1), S.brand('IncreaseStep'))
export type IncreaseStep = S.Schema.Type<typeof IncreaseStep>

const HALVE_ON_EXHAUSTION = DecreaseFactor.make(0.5)
const GROW_BY_ONE = IncreaseStep.make(1)

export class BatchSizePolicy extends S.Class<BatchSizePolicy>('BatchSizePolicy')({
  max: BatchSize,
  decreaseFactor: DecreaseFactor,
  increaseStep: IncreaseStep,
}) {
  static readonly Default = (max: BatchSize): BatchSizePolicy =>
    new BatchSizePolicy({ max, decreaseFactor: HALVE_ON_EXHAUSTION, increaseStep: GROW_BY_ONE })
}

// =============================================================================
// Batch outcome (boundary value object)
// =============================================================================

const BatchOutcomeTypeId: unique symbol = Symbol.for('@app/batch-backoff/BatchOutcome')
type BatchOutcomeTypeId = typeof BatchOutcomeTypeId

export class Succeeded extends S.TaggedClass<Succeeded>()('Succeeded', {}) {
  readonly [BatchOutcomeTypeId] = BatchOutcomeTypeId
}
export class ResourceExhausted extends S.TaggedClass<ResourceExhausted>()('ResourceExhausted', {}) {
  readonly [BatchOutcomeTypeId] = BatchOutcomeTypeId
}
export class OtherFailure extends S.TaggedClass<OtherFailure>()('OtherFailure', {}) {
  readonly [BatchOutcomeTypeId] = BatchOutcomeTypeId
}
export const BatchOutcome = S.Union(Succeeded, ResourceExhausted, OtherFailure)
export type BatchOutcome = S.Schema.Type<typeof BatchOutcome>
