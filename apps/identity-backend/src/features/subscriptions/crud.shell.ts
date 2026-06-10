import { DB, schema } from '#root/db/mod.js'
import { and, eq, ne, sql } from 'drizzle-orm'
import { Clock, Context, Duration, Effect, Layer, Match, Metric, Redacted, Schedule, Schema as S } from 'effect'
import { SubscriptionNotFoundError } from './errors.js'
import { SelectPushSubscriptionACL, UpsertPushSubscriptionACL } from './subscriptions.adapter.js'
import { SpanAttributes, subscriptionCreationsCounter, subscriptionRuleMatchCounter } from './telemetry.js'
import { NotifyType, Subscription, SubscriptionId, type TokenMobile, type TokenWeb } from './types.js'

export interface UpsertResult {
  readonly created: boolean
  readonly subscription: Subscription
}

export namespace SubscriptionCrudShell {
  export interface Definition {
    readonly upsert: (
      clientId: string,
      notificationType: NotifyType,
      token: TokenMobile | TokenWeb,
    ) => Effect.Effect<UpsertResult, never>

    readonly getAll: (
      clientId: string,
    ) => Effect.Effect<readonly Subscription[], never>

    readonly remove: (
      clientId: string,
      subscriptionId: SubscriptionId,
    ) => Effect.Effect<void, SubscriptionNotFoundError>
  }
}

const dbRetry = Schedule.exponential(Duration.millis(100), 2).pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(3)),
)

const returningColumns = {
  id: schema.pushSubscription.id,
  clientId: schema.pushSubscription.clientId,
  notificationType: schema.pushSubscription.notificationType,
  token: schema.pushSubscription.token,
  endpoint: schema.pushSubscription.endpoint,
  p256dhKey: schema.pushSubscription.p256dhKey,
  authKey: schema.pushSubscription.authKey,
  contentEncoding: schema.pushSubscription.contentEncoding,
  createdAt: schema.pushSubscription.createdAt,
  updatedAt: schema.pushSubscription.updatedAt,
  created: sql<boolean>`xmax = 0`,
}

// When the same physical device re-subscribes under a different clientId we drop the
// stale row so the unique-per-channel constraint stays satisfied. Match on whichever
// identifier the new variant carries — token for mobile, endpoint for web.
const ownerCollisionPredicate = (clientId: string, token: TokenMobile | TokenWeb) =>
  Match.value(token).pipe(
    Match.tag(
      'Mobile',
      (t) =>
        and(eq(schema.pushSubscription.token, Redacted.value(t.token)), ne(schema.pushSubscription.clientId, clientId)),
    ),
    Match.tag(
      'Web',
      (t) => and(eq(schema.pushSubscription.endpoint, t.endpoint), ne(schema.pushSubscription.clientId, clientId)),
    ),
    Match.exhaustive,
  )

const make = Effect.gen(function*() {
  const db = yield* DB

  const upsert = Effect.fn('subscription.upsert')(
    function*(clientId: string, notificationType: NotifyType, token: TokenMobile | TokenWeb) {
      yield* Effect.annotateCurrentSpan({
        [SpanAttributes.SUBSCRIPTION_NOTIFICATION_TYPE]: notificationType,
      })

      const values = yield* S.encode(UpsertPushSubscriptionACL)({ clientId, notificationType, token }).pipe(
        Effect.orDie,
      )
      const collision = ownerCollisionPredicate(clientId, token)

      const row = yield* Effect.gen(function*() {
        const nowMillis = yield* Clock.currentTimeMillis
        return yield* Effect.tryPromise({
          try: () =>
            db.transaction(async (tx) => {
              await tx.delete(schema.pushSubscription).where(collision)

              const [returned] = await tx.insert(schema.pushSubscription)
                .values(values)
                .onConflictDoUpdate({
                  target: [
                    schema.pushSubscription.clientId,
                    schema.pushSubscription.notificationType,
                  ],
                  set: {
                    token: values.token,
                    endpoint: values.endpoint,
                    p256dhKey: values.p256dhKey,
                    authKey: values.authKey,
                    contentEncoding: values.contentEncoding,
                    updatedAt: new Date(nowMillis),
                  },
                })
                .returning(returningColumns)
              return returned!
            }, { isolationLevel: 'serializable' }),
          catch: (err) => new Error('DB error in subscription upsert', { cause: err }),
        })
      }).pipe(Effect.retry(dbRetry), Effect.orDie)

      if (row.created) {
        yield* Effect.logDebug('Subscription created', {
          [SpanAttributes.SUBSCRIPTION_ID]: row.id,
          [SpanAttributes.SUBSCRIPTION_NOTIFICATION_TYPE]: notificationType,
        })
        yield* Metric.increment(subscriptionCreationsCounter)
        yield* Metric.increment(
          Metric.tagged(Metric.tagged(subscriptionRuleMatchCounter, 'operation', 'create'), 'result', 'success'),
        )
      } else {
        yield* Effect.logDebug('Subscription updated', {
          [SpanAttributes.SUBSCRIPTION_ID]: row.id,
        })
      }

      const subscription = yield* S.decode(SelectPushSubscriptionACL)(row).pipe(Effect.orDie)

      return { created: row.created, subscription }
    },
    Effect.scoped,
    Effect.withLogSpan('subscription.upsert'),
  ) satisfies SubscriptionCrudShell.Definition['upsert']

  const getAll = Effect.fn('subscription.get_all')(
    function*(clientId) {
      const rows = yield* Effect.tryPromise(() =>
        db.select().from(schema.pushSubscription)
          .where(eq(schema.pushSubscription.clientId, clientId))
      ).pipe(Effect.orDie)

      const decode = S.decode(SelectPushSubscriptionACL)
      return yield* Effect.allSuccesses(
        rows.map((row) =>
          decode(row).pipe(
            Effect.tapError((e) => Effect.logWarning('Corrupt subscription row skipped', { id: row.id, error: e })),
          )
        ),
      )
    },
  ) satisfies SubscriptionCrudShell.Definition['getAll']

  const remove = Effect.fn('subscription.remove')(
    function*(clientId, subscriptionId) {
      const rows = yield* Effect.tryPromise(() =>
        db.select({ id: schema.pushSubscription.id }).from(schema.pushSubscription)
          .where(
            and(
              eq(schema.pushSubscription.id, subscriptionId),
              eq(schema.pushSubscription.clientId, clientId),
            ),
          )
          .limit(1)
      ).pipe(Effect.orDie)

      if (rows.length === 0) {
        return yield* new SubscriptionNotFoundError({ identifier: subscriptionId })
      }

      yield* Effect.tryPromise(() =>
        db.delete(schema.pushSubscription).where(eq(schema.pushSubscription.id, subscriptionId))
      ).pipe(Effect.orDie)

      yield* Effect.logDebug('Subscription removed', {
        [SpanAttributes.SUBSCRIPTION_ID]: subscriptionId,
      })
    },
    Effect.scoped,
    Effect.withLogSpan('subscription.remove'),
  ) satisfies SubscriptionCrudShell.Definition['remove']

  return SubscriptionCrudShell.of({ upsert, getAll, remove })
})

export class SubscriptionCrudShell extends Context.Tag('@app/SubscriptionCrudShell')<
  SubscriptionCrudShell,
  SubscriptionCrudShell.Definition
>() {
  static readonly Default = Layer.scoped(SubscriptionCrudShell, make)
}
