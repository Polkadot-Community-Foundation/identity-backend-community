import { Daemon } from '@identity-backend/effect-daemon-spec'
import { sql } from 'drizzle-orm'
import { Context, Duration, Effect, Match, Metric, Schedule, Schema as S } from 'effect'

import { EffectSQLDb } from '#root/db/effect-sql-db.js'

import { DatabaseIoFromRaw } from '../decode-pg-stats.acl.js'
import { cacheHitRatio, deadlocks, decodeFailuresTotal } from '../metrics.js'

export interface PgMonitorIoRuntimeConfig {
  readonly interval: Duration.Duration
  readonly tickTimeout: Duration.Duration
}

export class PgMonitorIoConfig extends Context.Reference<PgMonitorIoConfig>()(
  'identity-backend-container/PgMonitorIoConfig',
  {
    defaultValue: (): PgMonitorIoRuntimeConfig => ({
      interval: Duration.seconds(60),
      tickTimeout: Duration.seconds(5),
    }),
  },
) {}

const ioQuery = sql`
  SELECT
    blks_hit::text AS blks_hit,
    blks_read::text AS blks_read,
    deadlocks::text AS deadlocks
  FROM pg_stat_database
  WHERE datname = current_database()
`

const queryRetry = Schedule.jittered(Schedule.exponential(Duration.millis(200)))

type IoRow = Readonly<Record<string, unknown>>

const runQuery = (
  db: EffectSQLDb['Type'],
  query: ReturnType<typeof sql>,
): Effect.Effect<ReadonlyArray<IoRow>, unknown> => db.execute<IoRow>(query)

const computeCacheHitRatio = (blksHit: number, blksRead: number): number =>
  Match.value(blksHit + blksRead).pipe(
    Match.when(0, () => Number.NaN),
    Match.orElse((total) => blksHit / total),
  )

const decodeIoStats = S.decodeUnknownEither(DatabaseIoFromRaw)

export const makePgMonitorIoWorker = Effect.gen(function*() {
  const db = yield* EffectSQLDb
  const config = yield* PgMonitorIoConfig

  const work = Effect.gen(function*() {
    const rows = yield* runQuery(db, ioQuery)
    const stats = yield* decodeIoStats(rows).pipe(
      Effect.tapError((cause) =>
        Metric.increment(decodeFailuresTotal).pipe(
          Effect.zipRight(Effect.logWarning('PgMonitor io decode failed', cause)),
        )
      ),
    )

    yield* Metric.set(cacheHitRatio, computeCacheHitRatio(stats.blksHit, stats.blksRead))
    yield* Metric.set(deadlocks, stats.deadlocks)
  })

  return Daemon.poll({
    name: 'pg-monitor-io',
    work,
    interval: config.interval,
    tick: {
      spanName: 'pg_monitor.io_cycle',
      tickTimeout: config.tickTimeout,
    },
    tickHooks: { innerRetry: queryRetry },
    lock: { mode: 'none' },
  })
})

if (import.meta.vitest) {
  const { describe, it } = await import('@effect/vitest')

  describe('computeCacheHitRatio', () => {
    it.prop(
      '∀x_CacheHitRatio_≡HitsOverTotal',
      [S.NonNegativeInt, S.NonNegativeInt],
      ([blksHit, blksRead]) => {
        const ratio = computeCacheHitRatio(blksHit, blksRead)
        const total = blksHit + blksRead
        return total === 0
          ? Number.isNaN(ratio)
          : ratio === blksHit / total && ratio >= 0 && ratio <= 1
      },
    )
  })
}
