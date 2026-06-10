import { DB, schema } from '#root/db/mod.js'
import { SelectPushSubscriptionACL } from '#root/features/subscriptions/subscriptions.adapter.js'
import { eq } from 'drizzle-orm'
import { Duration, Effect, Schedule, Schema as S } from 'effect'
import { SubscriptionNotFoundError as SubscriptionNotFoundErrorClass } from './errors.js'

const dbRetry = Schedule.exponential(Duration.millis(100), 2).pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(3)),
)

export const makeRequireSubscriptionByClientId = (db: DB.DB) =>
  Effect.fn('subscription.require_by_client_id')(
    function*(clientId: string) {
      const rows = yield* Effect.tryPromise(() =>
        db.select().from(schema.pushSubscription)
          .where(eq(schema.pushSubscription.clientId, clientId))
          .limit(1)
      ).pipe(
        Effect.retry(dbRetry),
        Effect.orDie,
      )

      yield* Effect.annotateCurrentSpan({ 'subscription.client_id': clientId, 'db.table': 'push_subscriptions' })

      const row = rows[0]
      if (!row) {
        return yield* new SubscriptionNotFoundErrorClass({ identifier: clientId })
      }

      return yield* S.decode(SelectPushSubscriptionACL)(row).pipe(Effect.orDie)
    },
  )

export const makeRequireSubscriptionById = (db: DB.DB) =>
  Effect.fn('subscription.require_by_id')(
    function*(id: string) {
      const rows = yield* Effect.tryPromise(() =>
        db.select().from(schema.pushSubscription)
          .where(eq(schema.pushSubscription.id, id))
          .limit(1)
      ).pipe(
        Effect.retry(dbRetry),
        Effect.orDie,
      )

      yield* Effect.annotateCurrentSpan({ 'subscription.id': id, 'db.table': 'push_subscriptions' })

      const row = rows[0]
      if (!row) {
        return yield* new SubscriptionNotFoundErrorClass({ identifier: id })
      }

      return yield* S.decode(SelectPushSubscriptionACL)(row).pipe(Effect.orDie)
    },
  )
