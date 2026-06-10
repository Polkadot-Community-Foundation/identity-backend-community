import { DB } from '#root/db/mod.js'
import { delivery } from '@identity-backend/mobile-push-notifications'
import { Context, Effect, HashSet, Layer, Metric, Redacted, Schema as S } from 'effect'
import { fromHex } from 'polkadot-api/utils'
import { BroadcastFailedError } from '../errors.js'
import { PushDeliveryShell } from '../pipeline/delivery.shell.js'
import { buildRateLimitMap, DEFAULT_RATE_LIMIT_CONFIG } from '../pipeline/rate-limit.js'
import { broadcastCounter } from '../telemetry.js'
import { canonicalizeBroadcast, computeDeliveryPlan, hashBroadcastPayload } from './push-broadcast.core.js'

import { claimDeliveries, findDeliveryTargets, findExistingClaims, findRateLimits } from './push-broadcast.store.js'

import { PipelineRateLimitConfig, PublicKey, StatementHash } from '../types.js'

export interface PushBroadcastUseCaseInput {
  readonly signer: string
  readonly topics: readonly string[]
  readonly content: { readonly title: string; readonly body: string; readonly deeplink?: string }
}

export interface PushBroadcastUseCaseResult {
  readonly messageHash: string
  readonly delivered: number
  readonly broadcastId: string
}

export class PushBroadcastUseCaseRuntimeConfig extends Context.Reference<PushBroadcastUseCaseRuntimeConfig>()(
  'PushBroadcastUseCaseRuntimeConfig',
  {
    defaultValue: () => ({
      deliveryConcurrency: 20,
    }),
  },
) {}

const make = Effect.gen(function*() {
  const db = yield* DB
  const deliveryShell = yield* PushDeliveryShell
  const { deliveryConcurrency } = yield* PushBroadcastUseCaseRuntimeConfig

  const execute = Effect.fn('push_broadcast.execute')((input: PushBroadcastUseCaseInput) =>
    Effect.gen(function*() {
      const broadcastId = crypto.randomUUID()
      const canonical = canonicalizeBroadcast(input)
      const messageHash = hashBroadcastPayload(canonical)
      const sh = StatementHash.make(messageHash)

      const matchedSubs = yield* findDeliveryTargets(input.signer, input.topics)
      if (matchedSubs.length === 0) {
        yield* Metric.increment(Metric.tagged(broadcastCounter, 'outcome', 'no_matches'))
        return { messageHash, delivered: 0, broadcastId }
      }

      const subscriptionIds = matchedSubs.map((m) => m.subscription.id)
      const clientIds = [...HashSet.fromIterable(matchedSubs.map((m) => m.subscription.clientId))]

      const matchEntries = matchedSubs.map((m) => ({
        subscriptionId: m.subscription.id,
        ruleId: m.rule.id,
        clientId: m.subscription.clientId,
        notificationType: m.subscription.notificationType,
        topic: m.rule.topic,
        channel: delivery.selectChannel(m.subscription.notificationType),
      }))

      const content: Record<string, unknown> = input.content.deeplink === undefined
        ? { title: input.content.title, body: input.content.body }
        : { title: input.content.title, body: input.content.body, deeplink: input.content.deeplink }
      const statementData = JSON.stringify(content)

      const [existingClaimIds, rateLimitRows] = yield* Effect.all([
        findExistingClaims(sh, subscriptionIds),
        findRateLimits(input.signer, clientIds),
      ])

      const rateLimitConfig = yield* S.decode(PipelineRateLimitConfig)(DEFAULT_RATE_LIMIT_CONFIG).pipe(Effect.orDie)
      const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
      const rateLimitMap = buildRateLimitMap(rateLimitRows)

      const plan = computeDeliveryPlan({
        matches: matchEntries,
        existingClaims: HashSet.fromIterable(existingClaimIds),
        rateLimitMap,
        rateLimitConfig,
        now: new Date(now),
      })

      if (plan.deliveries.length === 0) {
        yield* Metric.increment(Metric.tagged(broadcastCounter, 'outcome', 'no_claimable'))
        return { messageHash, delivered: 0, broadcastId }
      }

      const claimed = yield* claimDeliveries(input.signer, messageHash, plan.deliveries, plan.rateUpdates)
      if (claimed.length === 0) {
        yield* Metric.increment(Metric.tagged(broadcastCounter, 'outcome', 'no_claimable'))
        return { messageHash, delivered: 0, broadcastId }
      }

      const senderPubkey = Redacted.make(PublicKey.make(fromHex(input.signer)))
      const claimedSet = HashSet.fromIterable(claimed)
      const planMatches = matchedSubs.filter((m) => HashSet.has(claimedSet, m.subscription.id))

      const deliveryResults = yield* Effect.all(
        planMatches.map((m) =>
          deliveryShell.deliverPlan({
            plan: {
              subscriptionId: m.subscription.id,
              ruleId: m.rule.id,
              senderPubkey: m.rule.senderPubkey,
              topic: m.rule.topic,
            },
            subscription: m.subscription,
            rule: m.rule,
            statementHash: sh,
            statementData,
            content,
            senderPubkey,
            topic: m.rule.topic,
            rateState: undefined,
            now,
          }).pipe(
            Effect.catchTags({
              PushDeliveryFailed: () => Effect.succeed(0),
              PushNotificationTokenInvalidError: () => Effect.succeed(0),
            }),
          )
        ),
        { concurrency: deliveryConcurrency },
      )
      const delivered = deliveryResults.reduce((sum, count) => sum + count, 0)

      yield* Metric.increment(Metric.tagged(broadcastCounter, 'outcome', 'delivered'))
      return { messageHash, delivered, broadcastId }
    }).pipe(
      Effect.provideService(DB, db),
      Effect.scoped,
    )
  )

  return PushBroadcastUseCase.of({ execute })
})

export namespace PushBroadcastUseCase {
  export interface Definition {
    readonly execute: (
      input: PushBroadcastUseCaseInput,
    ) => Effect.Effect<
      PushBroadcastUseCaseResult,
      BroadcastFailedError
    >
  }
}

export class PushBroadcastUseCase extends Context.Tag('@app/PushBroadcastUseCase')<
  PushBroadcastUseCase,
  PushBroadcastUseCase.Definition
>() {
  static readonly Default = Layer.scoped(PushBroadcastUseCase, make).pipe(
    Layer.provide(PushDeliveryShell.Default),
  )
}
