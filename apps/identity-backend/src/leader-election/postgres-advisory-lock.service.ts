import * as schema from '#root/db/schema.js'
import { PgClient } from '@effect/sql-pg/PgClient'
import { LeaderLock, LeaderLockInfraError } from '@identity-backend/effect-daemon-spec'
import { eq, sql } from 'drizzle-orm'
import * as PgDrizzle from 'drizzle-orm/effect-postgres'
import { Clock, Context, Duration, Effect, Layer, Option, Schedule } from 'effect'
import { LeaderElectionDb } from './pool.js'

export class PostgresAdvisoryLeaderLockServiceConfig
  extends Context.Tag('PostgresAdvisoryLeaderLockServiceConfig')<PostgresAdvisoryLeaderLockServiceConfig, {
    readonly podId: string
    readonly reaperInterval: Duration.Duration
  }>()
{}

const trackingRetryConfig = { times: 3, schedule: Schedule.exponential(Duration.millis(200)) } as const

export const PostgresAdvisoryLeaderLockLive = Layer.scoped(
  LeaderLock,
  Effect.gen(function*() {
    const pgClient = yield* LeaderElectionDb
    const db = yield* PgDrizzle.makeWithDefaults({ schema: { leaderElection: schema.leaderElection } }).pipe(
      Effect.provide(Layer.effect(PgClient, Effect.succeed(pgClient))),
    )
    const { podId } = yield* PostgresAdvisoryLeaderLockServiceConfig

    yield* Effect.annotateLogsScoped({ 'app.lock.holder': podId })

    const leaderLock = LeaderLock.of({
      withLock: <A, E, R>(
        key: string,
        self: Effect.Effect<A, E, R>,
      ): Effect.Effect<Option.Option<A>, E | LeaderLockInfraError, R> =>
        Effect.gen(function*() {
          const conn = yield* pgClient.reserve.pipe(
            Effect.mapError((cause) => new LeaderLockInfraError({ key, cause })),
          )
          const acquiredAt = new Date(yield* Clock.currentTimeMillis)
          const acquired = yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function*() {
              const rows = yield* restore(
                conn.execute(
                  'SELECT pg_try_advisory_lock(hashtext($1)) as acquired',
                  [key],
                  undefined,
                ).pipe(Effect.mapError((cause) => new LeaderLockInfraError({ key, cause }))),
              )
              if (rows[0]?.acquired !== true) {
                return 0
              }

              yield* Effect.addFinalizer(() =>
                conn.execute(
                  'SELECT pg_advisory_unlock(hashtext($1))',
                  [key],
                  undefined,
                ).pipe(Effect.ignore)
              )
              yield* Effect.logInfo('Leader lock acquired', { 'app.lock.key': key })

              const trackingResult = yield* Effect.acquireRelease(
                db.insert(schema.leaderElection)
                  .values({ key, holder: podId, acquiredAt })
                  .onConflictDoUpdate({
                    target: schema.leaderElection.key,
                    set: {
                      holder: podId,
                      acquiredAt,
                      generation: sql`${schema.leaderElection.generation} + 1`,
                    },
                  })
                  .returning({ generation: schema.leaderElection.generation })
                  .pipe(
                    Effect.retry(trackingRetryConfig),
                    Effect.tapError((e) =>
                      Effect.logError('Tracking insert retries exhausted', {
                        'app.lock.key': key,
                        cause: e,
                      })
                    ),
                    Effect.orDie,
                  ),
                () =>
                  db.delete(schema.leaderElection).where(eq(schema.leaderElection.key, key)).pipe(
                    Effect.ignore,
                  ),
              )

              return trackingResult[0]?.generation ?? 0
            })
          )
          if (acquired === 0) return Option.none()
          return Option.some(yield* self)
        }).pipe(Effect.scoped),
    })

    return leaderLock
  }),
)
