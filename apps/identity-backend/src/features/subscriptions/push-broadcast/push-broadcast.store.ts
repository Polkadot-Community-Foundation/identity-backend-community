import { and, eq, inArray } from 'drizzle-orm'
import { Effect, Schema as S } from 'effect'

import { DB, schema } from '#root/db/mod.js'
import {
  SelectPushSubscriptionACL,
  SelectRateLimitSchema,
  SelectSubscriptionRuleACL,
} from '#root/features/subscriptions/subscriptions.adapter.js'

import { BroadcastFailedError } from '../errors.js'
import { Subscription, SubscriptionRule } from '../types.js'

export interface MatchedSubscription {
  readonly subscription: S.Schema.Type<typeof Subscription>
  readonly rule: S.Schema.Type<typeof SubscriptionRule>
}

export const findDeliveryTargets = Effect.fn('push_broadcast.store.find_delivery_targets')(
  function*(senderPubkey: string, topics: readonly string[]) {
    if (topics.length === 0) return []
    const db = yield* DB

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ rule: schema.subscriptionRule, subscription: schema.pushSubscription })
          .from(schema.subscriptionRule)
          .innerJoin(
            schema.pushSubscription,
            eq(schema.subscriptionRule.subscriptionId, schema.pushSubscription.id),
          )
          .where(
            and(
              eq(schema.subscriptionRule.senderPubkey, senderPubkey),
              inArray(schema.subscriptionRule.topic, [...topics]),
            ),
          ),
      catch: (cause) => new BroadcastFailedError({ cause }),
    })

    return yield* Effect.all(
      rows.map((row) =>
        Effect.zip(
          S.decode(SelectPushSubscriptionACL)(row.subscription).pipe(Effect.orDie),
          S.decode(SelectSubscriptionRuleACL)(row.rule).pipe(Effect.orDie),
        ).pipe(Effect.map(([subscription, rule]) => ({ subscription, rule })))
      ),
    )
  },
)

export const findExistingClaims = Effect.fn('push_broadcast.store.find_existing_claims')(
  function*(statementHash: string, subscriptionIds: readonly string[]) {
    const db = yield* DB
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ subscriptionId: schema.pushRecord.subscriptionId })
          .from(schema.pushRecord)
          .where(
            and(
              inArray(schema.pushRecord.subscriptionId, subscriptionIds),
              eq(schema.pushRecord.statementHash, statementHash),
            ),
          ),
      catch: (cause) => new BroadcastFailedError({ cause }),
    })
    return rows.map((r) => r.subscriptionId)
  },
)

export const findRateLimits = Effect.fn('push_broadcast.store.find_rate_limits')(
  function*(senderPubkey: string, clientIds: readonly string[]) {
    const db = yield* DB
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(schema.rateLimit)
          .where(
            and(
              eq(schema.rateLimit.senderPubkey, senderPubkey),
              inArray(schema.rateLimit.clientId, clientIds),
            ),
          ),
      catch: (cause) => new BroadcastFailedError({ cause }),
    })
    return yield* S.decodeUnknown(S.Array(SelectRateLimitSchema))(rows).pipe(Effect.orDie)
  },
)

export const claimDeliveries = Effect.fn('push_broadcast.store.claim_deliveries')(
  function*(
    signerPubkey: string,
    statementHash: string,
    deliveries: readonly {
      subscriptionId: string
      ruleId: string
      topic: string
      channel: string
      notificationType: string
    }[],
    rateUpdates: readonly {
      clientId: string
      windowStart: Date
      notificationCount: number
    }[],
  ) {
    const db = yield* DB
    return yield* Effect.tryPromise({
      try: () =>
        db.transaction(async (tx) => {
          const inserted = await tx
            .insert(schema.pushRecord)
            .values(
              deliveries.map((d) => ({
                subscriptionId: d.subscriptionId,
                statementHash,
                senderPubkey: signerPubkey,
                topic: d.topic,
                notifyType: d.notificationType,
                deliveryChannel: d.channel,
              })),
            )
            .onConflictDoNothing({
              target: [schema.pushRecord.subscriptionId, schema.pushRecord.statementHash],
            })
            .returning({ subscriptionId: schema.pushRecord.subscriptionId })

          for (const update of rateUpdates) {
            await tx
              .insert(schema.rateLimit)
              .values({
                senderPubkey: signerPubkey,
                clientId: update.clientId,
                windowStart: update.windowStart,
                notificationCount: update.notificationCount,
              })
              .onConflictDoUpdate({
                target: [schema.rateLimit.senderPubkey, schema.rateLimit.clientId],
                set: {
                  windowStart: update.windowStart,
                  notificationCount: update.notificationCount,
                },
              })
          }

          return inserted.map((r) => r.subscriptionId)
        }),
      catch: (cause) => new BroadcastFailedError({ cause }),
    })
  },
)
