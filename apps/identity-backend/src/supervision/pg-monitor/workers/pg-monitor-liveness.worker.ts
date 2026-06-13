import { Daemon } from '@identity-backend/effect-daemon-spec'
import { sql } from 'drizzle-orm'
import { Clock, Context, Duration, Effect, Either, Metric, Schedule, Schema as S } from 'effect'

import { EffectSQLDb } from '#root/db/effect-sql-db.js'

import { ServerMaxConnectionsFromRaw } from '../decode-pg-stats.acl.js'
import { decodeFailuresTotal, lastSuccessfulPollTimestamp, serverMaxConnections } from '../metrics.js'

export interface PgMonitorLivenessRuntimeConfig {
  readonly interval: Duration.Duration
  readonly tickTimeout: Duration.Duration
}

export class PgMonitorLivenessConfig extends Context.Reference<PgMonitorLivenessConfig>()(
  'identity-backend-container/PgMonitorLivenessConfig',
  {
    defaultValue: (): PgMonitorLivenessRuntimeConfig => ({
      interval: Duration.seconds(60),
      tickTimeout: Duration.seconds(5),
    }),
  },
) {}

const maxConnectionsQuery = sql`
  SELECT setting::text AS max_connections FROM pg_settings WHERE name = 'max_connections'
`

const queryRetry = Schedule.jittered(Schedule.exponential(Duration.millis(200)))

type Row = Readonly<Record<string, unknown>>

const runQuery = (
  db: EffectSQLDb['Type'],
  query: ReturnType<typeof sql>,
): Effect.Effect<ReadonlyArray<Row>, unknown> => db.execute<Row>(query)

const decodeMaxConnections = S.decodeUnknownEither(ServerMaxConnectionsFromRaw)

const emitServerMaxConnections = (db: EffectSQLDb['Type']): Effect.Effect<void, never> =>
  runQuery(db, maxConnectionsQuery).pipe(
    Effect.flatMap((rows) =>
      Either.match(decodeMaxConnections(rows), {
        onLeft: (cause) =>
          Metric.increment(decodeFailuresTotal).pipe(
            Effect.zipRight(Effect.logWarning('PgMonitor max_connections decode failed', cause)),
          ),
        onRight: (value) =>
          Metric.set(serverMaxConnections, value).pipe(
            Effect.zipRight(
              Effect.logInfo('PostgreSQL server max_connections', {
                'event': 'pg.server.max_connections',
                'pg.server.max_connections': value,
              }),
            ),
          ),
      })
    ),
    Effect.tapError((cause) => Effect.logWarning('PgMonitor max_connections read failed', cause)),
    Effect.catchAll(() => Effect.void),
  )

export const makePgMonitorLivenessWorker = Effect.gen(function*() {
  const db = yield* EffectSQLDb
  const config = yield* PgMonitorLivenessConfig

  yield* emitServerMaxConnections(db)

  const work = Effect.gen(function*() {
    yield* Metric.set(lastSuccessfulPollTimestamp, yield* Clock.currentTimeMillis)
  })

  return Daemon.poll({
    name: 'pg-monitor-liveness',
    work,
    interval: config.interval,
    tick: {
      spanName: 'pg_monitor.liveness_cycle',
      tickTimeout: config.tickTimeout,
      startLogLevel: 'info',
    },
    tickHooks: { innerRetry: queryRetry },
    lock: { mode: 'none' },
  })
})
