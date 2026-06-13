import { Daemon } from '@identity-backend/effect-daemon-spec'
import { sql } from 'drizzle-orm'
import { Context, Duration, Effect, Metric, Schedule, Schema as S } from 'effect'

import { EffectSQLDb } from '#root/db/effect-sql-db.js'

import { DatabaseSizeFromRaw } from '../decode-pg-stats.acl.js'
import { databaseSizeBytes, decodeFailuresTotal } from '../metrics.js'

export interface PgMonitorCapacityRuntimeConfig {
  readonly interval: Duration.Duration
  readonly tickTimeout: Duration.Duration
}

export class PgMonitorCapacityConfig extends Context.Reference<PgMonitorCapacityConfig>()(
  'identity-backend-container/PgMonitorCapacityConfig',
  {
    defaultValue: (): PgMonitorCapacityRuntimeConfig => ({
      interval: Duration.minutes(15),
      tickTimeout: Duration.seconds(5),
    }),
  },
) {}

const databaseSizeQuery = sql`
  SELECT pg_database_size(current_database())::text AS size_bytes
`

const queryRetry = Schedule.jittered(Schedule.exponential(Duration.millis(200)))

type Row = Readonly<Record<string, unknown>>

const runQuery = (
  db: EffectSQLDb['Type'],
  query: ReturnType<typeof sql>,
): Effect.Effect<ReadonlyArray<Row>, unknown> => db.execute<Row>(query)

const decodeDatabaseSize = S.decodeUnknownEither(DatabaseSizeFromRaw)

export const makePgMonitorCapacityWorker = Effect.gen(function*() {
  const db = yield* EffectSQLDb
  const config = yield* PgMonitorCapacityConfig

  const work = Effect.gen(function*() {
    const rows = yield* runQuery(db, databaseSizeQuery)
    const decoded = yield* decodeDatabaseSize(rows).pipe(
      Effect.tapError((cause) =>
        Metric.increment(decodeFailuresTotal).pipe(
          Effect.zipRight(Effect.logWarning('PgMonitor capacity decode failed', cause)),
        )
      ),
    )
    yield* Metric.set(databaseSizeBytes, decoded.sizeBytes)
  })

  return Daemon.poll({
    name: 'pg-monitor-capacity',
    work,
    interval: config.interval,
    tick: {
      spanName: 'pg_monitor.capacity_cycle',
      tickTimeout: config.tickTimeout,
    },
    tickHooks: { innerRetry: queryRetry },
    lock: { mode: 'none' },
  })
})
