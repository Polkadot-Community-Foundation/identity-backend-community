import { describe, it } from '@effect/vitest'
import { Arbitrary, Either, FastCheck as fc } from 'effect'
import { BatchSize, BatchSizePolicy, OtherFailure, ResourceExhausted, Succeeded } from '../batch-backoff.schema.js'
import { SettleBatchAttempt, settleBatchAttempt } from '../batch-backoff.workflow.js'

const arbPolicy = Arbitrary.make(BatchSizePolicy)

const arbPolicyAndCurrent = arbPolicy.chain((policy) =>
  fc.integer({ min: 1, max: policy.max }).map((c) => ({ policy, current: BatchSize.make(c) }))
)

const settle = (
  policy: BatchSizePolicy,
  current: BatchSize,
  outcome: SettleBatchAttempt['outcome'],
) => settleBatchAttempt(new SettleBatchAttempt({ policy, current, outcome }))

describe('settleBatchAttempt', () => {
  it.prop(
    '∀x_StayWithinBounds_∈x',
    [arbPolicyAndCurrent],
    ([{ policy, current }]) =>
      [new Succeeded({}), new ResourceExhausted({}), new OtherFailure({})].every((outcome) => {
        const size = Either.merge(settle(policy, current, outcome)).size
        return size >= 1 && size <= policy.max
      }),
  )

  it.prop(
    '∀x_SucceededGrowsAtMostOneStepToCap_=x',
    [arbPolicyAndCurrent],
    ([{ policy, current }]) =>
      Either.match(settle(policy, current, new Succeeded({})), {
        onLeft: () => false,
        onRight: (a) =>
          a.size >= current &&
          a.size <= policy.max &&
          a.size <= current + policy.increaseStep &&
          (a.size === policy.max || a.size === current + policy.increaseStep) &&
          (current < policy.max
            ? a._tag === 'BatchGrown' && a.from === current && a.size > current
            : a._tag === 'BatchSteady' && a.size === current),
      }),
  )

  it.prop(
    '∀x_ExhaustedThrottlesDownToFloor_=x',
    [arbPolicyAndCurrent],
    ([{ policy, current }]) =>
      Either.match(settle(policy, current, new ResourceExhausted({})), {
        onRight: () => false,
        onLeft: (r) =>
          r._tag === 'BatchThrottledError' &&
          r.from === current &&
          r.size >= 1 &&
          r.size <= current &&
          r.size <= current * policy.decreaseFactor + 1 &&
          (r.size === 1 || r.size > current * policy.decreaseFactor - 1),
      }),
  )

  it.prop(
    '∀x_FaultHoldsSize_=x',
    [arbPolicyAndCurrent],
    ([{ policy, current }]) =>
      Either.match(settle(policy, current, new OtherFailure({})), {
        onRight: () => false,
        onLeft: (r) => r._tag === 'BatchFaultedError' && r.size === current,
      }),
  )
})
