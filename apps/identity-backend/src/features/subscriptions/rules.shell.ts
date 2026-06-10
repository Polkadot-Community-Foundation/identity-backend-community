import { DB, schema } from '#root/db/mod.js'
import { and, eq, or } from 'drizzle-orm'
import { Clock, Context, Duration, Effect, HashMap, Layer, Metric, Redacted, Schedule, Schema as S } from 'effect'
import { fromHex, toHex } from 'polkadot-api/utils'
import { SubscriptionNotFoundError } from './errors.js'
import type { AddRulesRequest, DeleteRulesRequest, ReplaceRulesRequest } from './schema.js'
import { makeRequireSubscriptionById } from './shared.io.js'
import { SpanAttributes, subscriptionRuleMatchCounter } from './telemetry.js'
import { PublicKey, SubscriptionId, SubscriptionRule } from './types.js'

const dbRetry = Schedule.exponential(Duration.millis(100), 2).pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(3)),
)

const make = Effect.gen(function*() {
  const db = yield* DB
  const now = yield* Clock.currentTimeMillis

  const requireSubscriptionById = makeRequireSubscriptionById(db)
  const requireSubscriptionForClient = (subscriptionId: SubscriptionId, clientId: string) =>
    Effect.gen(function*() {
      const subscription = yield* requireSubscriptionById(subscriptionId)
      if (subscription.clientId !== clientId) {
        return yield* new SubscriptionNotFoundError({ identifier: subscriptionId })
      }
      return subscription
    })

  const getRules = Effect.fn('subscription.get_rules')(
    function*(subscriptionId) {
      yield* Effect.annotateCurrentSpan({ [SpanAttributes.SUBSCRIPTION_ID]: subscriptionId })

      return yield* Effect.tryPromise(() =>
        db.select().from(schema.subscriptionRule)
          .where(eq(schema.subscriptionRule.subscriptionId, subscriptionId))
      ).pipe(
        Effect.retry(dbRetry),
        Effect.flatMap((result) =>
          S.decode(S.Array(SubscriptionRule))(
            result.map((r) => ({ ...r, senderPubkey: Redacted.make(PublicKey.make(fromHex(r.senderPubkey))) })),
          )
        ),
        Effect.orDie,
      )
    },
  ) satisfies SubscriptionRulesShell.Definition['getRules']

  const addRules = Effect.fn('subscription.add_rules')(
    function*(clientId, subscriptionId, req) {
      yield* requireSubscriptionForClient(subscriptionId, clientId)

      yield* Effect.annotateCurrentSpan({
        [SpanAttributes.SUBSCRIPTION_ID]: subscriptionId,
        [SpanAttributes.RULES_COUNT]: String(req.rules.length),
      })
      yield* Effect.annotateLogsScoped({ [SpanAttributes.SUBSCRIPTION_ID]: subscriptionId })

      if (req.rules.length === 0) return { added: 0, total: 0 }

      const inserted = yield* Effect.tryPromise(() =>
        db.insert(schema.subscriptionRule).values(
          req.rules.map((r) => ({
            subscriptionId,
            senderPubkey: toHex(r.senderPubkey),
            topic: r.topic,
            createdAt: new Date(now),
          })),
        ).onConflictDoNothing().returning()
      ).pipe(Effect.orDie)

      const added = inserted.length
      const rules = yield* getRules(subscriptionId)

      yield* Effect.logDebug('Rules added to subscription', {
        [SpanAttributes.RULES_ADDED]: added,
        [SpanAttributes.RULES_TOTAL]: rules.length,
      })

      yield* Metric.increment(
        Metric.tagged(Metric.tagged(subscriptionRuleMatchCounter, 'operation', 'add'), 'result', 'success'),
      )

      return { added, total: rules.length }
    },
    Effect.scoped,
    Effect.withLogSpan('subscription.add_rules'),
  ) satisfies SubscriptionRulesShell.Definition['addRules']

  const deleteRules = Effect.fn('subscription.delete_rules')(
    function*(clientId, subscriptionId, req) {
      yield* requireSubscriptionForClient(subscriptionId, clientId)

      yield* Effect.annotateCurrentSpan({
        [SpanAttributes.SUBSCRIPTION_ID]: subscriptionId,
        [SpanAttributes.RULES_COUNT]: String(req.rules.length),
      })
      yield* Effect.annotateLogsScoped({ [SpanAttributes.SUBSCRIPTION_ID]: subscriptionId })

      if (req.rules.length === 0) return { removed: 0, total: 0 }

      const conditions = req.rules.map((r) =>
        and(
          eq(schema.subscriptionRule.subscriptionId, subscriptionId),
          eq(schema.subscriptionRule.senderPubkey, toHex(r.senderPubkey)),
          eq(schema.subscriptionRule.topic, r.topic),
        )
      )

      const result = yield* Effect.tryPromise(() =>
        db.delete(schema.subscriptionRule)
          .where(or(...conditions))
          .returning({ id: schema.subscriptionRule.id })
      ).pipe(
        Effect.orDie,
      )

      const removed = result.length

      const rules = yield* getRules(subscriptionId)

      yield* Effect.logDebug('Rules removed from subscription', {
        [SpanAttributes.RULES_REMOVED]: removed,
        [SpanAttributes.RULES_TOTAL]: rules.length,
      })

      yield* Metric.increment(
        Metric.tagged(Metric.tagged(subscriptionRuleMatchCounter, 'operation', 'delete'), 'result', 'success'),
      )

      return { removed, total: rules.length }
    },
    Effect.scoped,
    Effect.withLogSpan('subscription.delete_rules'),
  ) satisfies SubscriptionRulesShell.Definition['deleteRules']

  const replaceRules = Effect.fn('subscription.replace_rules')(
    function*(clientId, subscriptionId, req) {
      yield* requireSubscriptionForClient(subscriptionId, clientId)

      yield* Effect.annotateCurrentSpan({
        [SpanAttributes.SUBSCRIPTION_ID]: subscriptionId,
        [SpanAttributes.RULES_COUNT]: String(req.rules.length),
      })
      yield* Effect.annotateLogsScoped({ [SpanAttributes.SUBSCRIPTION_ID]: subscriptionId })

      const deduplicatedRules = Array.from(
        HashMap.values(
          HashMap.fromIterable(
            req.rules.map((r) =>
              [
                `${toHex(r.senderPubkey)}:${r.topic}`,
                r,
              ] as const
            ),
          ),
        ),
      )

      yield* Effect.tryPromise(() =>
        db.transaction(async (tx) => {
          await tx.delete(schema.subscriptionRule)
            .where(eq(schema.subscriptionRule.subscriptionId, subscriptionId))
          if (deduplicatedRules.length > 0) {
            await tx.insert(schema.subscriptionRule).values(
              deduplicatedRules.map((r) => ({
                subscriptionId,
                senderPubkey: toHex(r.senderPubkey),
                topic: r.topic,
                createdAt: new Date(now),
              })),
            )
          }
        })
      ).pipe(Effect.orDie)

      const rules = yield* getRules(subscriptionId)

      yield* Effect.logDebug('Rules replaced in subscription', {
        [SpanAttributes.RULES_REPLACED]: deduplicatedRules.length,
        [SpanAttributes.RULES_TOTAL]: rules.length,
      })

      yield* Metric.increment(
        Metric.tagged(Metric.tagged(subscriptionRuleMatchCounter, 'operation', 'replace'), 'result', 'success'),
      )

      return { replaced: deduplicatedRules.length, total: rules.length }
    },
    Effect.scoped,
    Effect.withLogSpan('subscription.replace_rules'),
  ) satisfies SubscriptionRulesShell.Definition['replaceRules']

  return SubscriptionRulesShell.of({ getRules, addRules, deleteRules, replaceRules })
}).pipe(
  Effect.scoped,
)

export namespace SubscriptionRulesShell {
  export interface Definition {
    readonly getRules: (
      subscriptionId: SubscriptionId,
    ) => Effect.Effect<readonly SubscriptionRule[], never>

    readonly addRules: (
      clientId: string,
      subscriptionId: SubscriptionId,
      req: AddRulesRequest,
    ) => Effect.Effect<{ added: number; total: number }, SubscriptionNotFoundError>

    readonly deleteRules: (
      clientId: string,
      subscriptionId: SubscriptionId,
      req: DeleteRulesRequest,
    ) => Effect.Effect<{ removed: number; total: number }, SubscriptionNotFoundError>

    readonly replaceRules: (
      clientId: string,
      subscriptionId: SubscriptionId,
      req: ReplaceRulesRequest,
    ) => Effect.Effect<{ replaced: number; total: number }, SubscriptionNotFoundError>
  }
}

export class SubscriptionRulesShell extends Context.Tag('@app/SubscriptionRulesShell')<
  SubscriptionRulesShell,
  SubscriptionRulesShell.Definition
>() {
  static readonly Default = Layer.scoped(SubscriptionRulesShell, make)
}
