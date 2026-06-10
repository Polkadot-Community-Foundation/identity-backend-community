/// <reference types="vitest/importMeta" />
import { Array, HashSet } from 'effect'
import {
  Deliver,
  DeliveryPlan,
  NoMatches,
  type ProcessingDecision,
  type ProcessStatementCommand,
  Skip,
  type SubscriptionId,
} from '../types.js'
import { calculateRateLimitOutput, ZERO_STATE } from './rate-limit.js'

const deduplicateBySubscription = <A extends { readonly subscriptionId: SubscriptionId }>(
  rules: readonly A[],
): readonly A[] => {
  let seen = HashSet.empty<SubscriptionId>()
  return Array.filter(rules, (rule) => {
    if (HashSet.has(rule.subscriptionId)(seen)) return false
    seen = HashSet.add(rule.subscriptionId)(seen)
    return true
  })
}

export const processStatement = (cmd: ProcessStatementCommand): ProcessingDecision => {
  if (cmd.rules.length === 0) return new NoMatches()

  if (cmd.existingHashes.some((h) => h === cmd.statementHash)) {
    return new Skip({ reason: 'duplicate' })
  }

  if (calculateRateLimitOutput(cmd.rateState ?? ZERO_STATE, cmd.now, cmd.rateLimitConfig) === 'blocked') {
    return new Skip({ reason: 'rate_limited' })
  }

  const uniqueRules = deduplicateBySubscription(cmd.rules)

  const plans = Array.map(uniqueRules, (rule) =>
    new DeliveryPlan({
      subscriptionId: rule.subscriptionId,
      ruleId: rule.id,
      senderPubkey: rule.senderPubkey,
      topic: rule.topic,
    }))
  return new Deliver({ plans })
}

// Stryker disable all
if (import.meta.vitest) {
  const { describe, it } = await import('@effect/vitest')
  const { Arbitrary, FastCheck: fc, Schema: S } = await import('effect')
  const { SubscriptionId } = await import('../types.js')

  const Item = S.Struct({ subscriptionId: SubscriptionId })

  const arrayWithDuplicateArb = Arbitrary.make(
    S.Array(Item).pipe(S.minItems(2)),
  ).chain((items) =>
    fc.integer({ min: 1, max: items.length - 1 }).map((dupIdx) =>
      items.map((item, idx) => idx === dupIdx ? { subscriptionId: items[0]!.subscriptionId } : item)
    )
  )

  describe('deduplicateBySubscription', () => {
    it.prop(
      '∀x_RemoveDuplicatesArrayContainsSharedSubscriptionIds_=x',
      [arrayWithDuplicateArb],
      ([items]) => {
        const result = deduplicateBySubscription(items)
        const uniqueIds = new Set(result.map((r) => r.subscriptionId))
        return uniqueIds.size === result.length && result.length < items.length
      },
    )
  })
}
