import { describe, it } from '@effect/vitest'
import { Arbitrary, FastCheck as fc, Match, Schema as S } from 'effect'
import {
  PipelineRateLimitConfig,
  PipelineRateState,
  ProcessStatementCommand,
  StatementHash,
  SubscriptionRule,
} from '../../types.js'
import { processStatement } from '../workflow.js'

const safeDateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })

const validCommandArb = fc.tuple(
  Arbitrary.make(PipelineRateLimitConfig),
  safeDateArb,
  Arbitrary.make(StatementHash),
).map(
  ([rateLimitConfig, now, statementHash]) =>
    new ProcessStatementCommand({
      rules: [],
      existingHashes: [],
      rateState: undefined,
      rateLimitConfig,
      now: new Date(now),
      statementHash,
    }),
)

const commandWithRulesArb = (minLength: number) =>
  fc.tuple(
    validCommandArb,
    Arbitrary.make(S.Array(SubscriptionRule).pipe(S.minItems(minLength))),
  ).map(
    ([cmd, rules]) =>
      new ProcessStatementCommand({
        rules,
        existingHashes: cmd.existingHashes,
        rateState: cmd.rateState,
        rateLimitConfig: cmd.rateLimitConfig,
        now: cmd.now,
        statementHash: cmd.statementHash,
      }),
  )

describe('processStatement', () => {
  it.prop(
    '∀x_ReturnNoMatchesRulesIsEmpty_=x',
    [validCommandArb, safeDateArb],
    ([cmd, now]) => {
      const rateState = S.decodeSync(PipelineRateState)({
        windowStart: new Date(now.getTime() - 500),
        notificationCount: 100,
      })
      const modifiedCmd = new ProcessStatementCommand({
        rules: [],
        existingHashes: [],
        now: new Date(now),
        rateState,
        rateLimitConfig: cmd.rateLimitConfig,
        statementHash: cmd.statementHash,
      })
      const result = processStatement(modifiedCmd)
      return Match.value(result).pipe(
        Match.tag('NoMatches', () => true),
        Match.orElse(() => false),
      )
    },
  )

  it.prop(
    '→x_ReturnSkipDuplicateHashExistsInExisting_=x',
    [commandWithRulesArb(1), safeDateArb],
    ([cmd, now]) => {
      const modifiedCmd = new ProcessStatementCommand({
        rules: cmd.rules,
        existingHashes: [cmd.statementHash],
        now: new Date(now),
        rateState: undefined,
        rateLimitConfig: cmd.rateLimitConfig,
        statementHash: cmd.statementHash,
      })
      const result = processStatement(modifiedCmd)
      return Match.value(result).pipe(
        Match.tag('Skip', (s) => s.reason === 'duplicate'),
        Match.orElse(() => false),
      )
    },
  )

  it.prop(
    '→x_ReturnSkipRateLimitedRateStateExceedsMax_=x',
    [commandWithRulesArb(1), safeDateArb],
    ([cmd, now]) => {
      const rateState = S.decodeSync(PipelineRateState)({
        windowStart: new Date(now),
        notificationCount: cmd.rateLimitConfig.maxPerWindow + 5,
      })
      const modifiedCmd = new ProcessStatementCommand({
        rules: cmd.rules,
        existingHashes: [],
        now: new Date(now),
        rateState,
        rateLimitConfig: cmd.rateLimitConfig,
        statementHash: cmd.statementHash,
      })
      const result = processStatement(modifiedCmd)
      return Match.value(result).pipe(
        Match.tag('Skip', (s) => s.reason === 'rate_limited'),
        Match.orElse(() => false),
      )
    },
  )

  it.prop(
    '∀x_ReturnDeliverNotDuplicateAndNotRateLimited_=x',
    [commandWithRulesArb(1), safeDateArb],
    ([cmd, now]) => {
      const modifiedCmd = new ProcessStatementCommand({
        rules: cmd.rules,
        existingHashes: [],
        now: new Date(now),
        rateState: undefined,
        rateLimitConfig: cmd.rateLimitConfig,
        statementHash: cmd.statementHash,
      })
      const result = processStatement(modifiedCmd)

      return Match.value(result).pipe(
        Match.tag('Deliver', (deliver) => {
          const uniqueSubIds = new Set(cmd.rules.map((r) => r.subscriptionId))
          return deliver.plans.length === uniqueSubIds.size &&
            deliver.plans.every((plan) => uniqueSubIds.has(plan.subscriptionId))
        }),
        Match.orElse(() => false),
      )
    },
  )

  it.prop(
    '→x_ReturnSkipDuplicateAlsoRateLimited_=x',
    [commandWithRulesArb(1), safeDateArb],
    ([cmd, now]) => {
      const rateState = S.decodeSync(PipelineRateState)({
        windowStart: new Date(now),
        notificationCount: cmd.rateLimitConfig.maxPerWindow + 10,
      })
      const modifiedCmd = new ProcessStatementCommand({
        rules: cmd.rules,
        existingHashes: [cmd.statementHash],
        now: new Date(now),
        rateState,
        rateLimitConfig: cmd.rateLimitConfig,
        statementHash: cmd.statementHash,
      })
      const result = processStatement(modifiedCmd)
      return Match.value(result).pipe(
        Match.tag('Skip', (s) => s.reason === 'duplicate'),
        Match.orElse(() => false),
      )
    },
  )

  it.prop(
    '∀x_DeliverOnePlanPerSubscriptionMultipleRulesShareSubscriptionId_=x',
    [commandWithRulesArb(2)],
    ([cmd]) => {
      const sharedSubId = cmd.rules[0]!.subscriptionId
      const dedupedRules = cmd.rules.map(
        (r) =>
          new SubscriptionRule({
            subscriptionId: sharedSubId,
            id: r.id,
            senderPubkey: r.senderPubkey,
            topic: r.topic,
            createdAt: r.createdAt,
          }),
      )
      const dedupedCmd = new ProcessStatementCommand({
        rules: dedupedRules,
        existingHashes: [],
        now: cmd.now,
        rateState: undefined,
        rateLimitConfig: cmd.rateLimitConfig,
        statementHash: cmd.statementHash,
      })
      const result = processStatement(dedupedCmd)

      return Match.value(result).pipe(
        Match.tag(
          'Deliver',
          (deliver) => deliver.plans.length === 1 && deliver.plans[0]!.subscriptionId === sharedSubId,
        ),
        Match.orElse(() => false),
      )
    },
  )
})
