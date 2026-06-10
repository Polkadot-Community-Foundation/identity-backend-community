import * as schema from '#root/db/schema.js'
import { PgClient } from '@effect/sql-pg/PgClient'
import { Daemon, run } from '@identity-backend/effect-daemon-spec'
import { inArray, sql } from 'drizzle-orm'
import * as PgDrizzle from 'drizzle-orm/effect-postgres'
import { Duration, Effect, Layer, Schedule, Schema } from 'effect'
import { LeaderElectionDb } from './pool.js'
import { PostgresAdvisoryLeaderLockServiceConfig } from './postgres-advisory-lock.service.js'

const StaleKeyRow = Schema.Struct({ key: Schema.String })
const reaperRetryConfig = { times: 3, schedule: Schedule.exponential(Duration.millis(200)) } as const

const reaperWork = (
  db: PgDrizzle.EffectPgDatabase<{ leaderElection: typeof schema.leaderElection }>,
): Effect.Effect<void, never, never> =>
  Effect.gen(function*() {
    // pg_locks splits the one-arg advisory key (hashtext->int4, sign-extended to bigint) into
    // classid (high 32 bits) + objid (low 32). Negative hashtext => classid=0xFFFFFFFF, not 0,
    // so `classid=0 AND objid=hashtext` misses live locks and reaps live leaders. Rebuild the key.
    const rawResult = yield* db.execute(sql`
      SELECT le.key FROM ${schema.leaderElection} le
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_locks l
        WHERE l.locktype = 'advisory'
        AND l.objsubid = 1
        AND l.granted = true
        AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtext(le.key)::bigint
      )
    `).pipe(
      Effect.retry(reaperRetryConfig),
      Effect.tapError((e) => Effect.logError('Reaper query retries exhausted', { cause: e })),
      Effect.orDie,
    )

    const staleKeys = yield* Schema.decodeUnknown(Schema.Array(StaleKeyRow))(rawResult).pipe(
      Effect.orDie,
    )

    if (staleKeys.length === 0) return

    const keys = staleKeys.map((r) => r.key)

    yield* db.delete(schema.leaderElection).where(inArray(schema.leaderElection.key, keys)).pipe(
      Effect.retry(reaperRetryConfig),
      Effect.tapError((e) => Effect.logError('Reaper cleanup retries exhausted', { cause: e })),
      Effect.orDie,
    )

    yield* Effect.logInfo('Reaper cleaned stale leader_election rows', {
      'app.reaper.stale_keys_deleted': keys.length,
    })
  })

export const reaperDaemon = Layer.scopedDiscard(
  Effect.gen(function*() {
    const pgClient = yield* LeaderElectionDb
    const db = yield* PgDrizzle.makeWithDefaults({ schema: { leaderElection: schema.leaderElection } }).pipe(
      Effect.provide(Layer.effect(PgClient, Effect.succeed(pgClient))),
    )
    const { reaperInterval } = yield* PostgresAdvisoryLeaderLockServiceConfig
    yield* run.worker(Daemon.poll({
      name: 'leader-election-reaper',
      work: reaperWork(db),
      interval: reaperInterval,
      tick: { tickTimeout: Duration.minutes(5) },
      lock: { mode: 'none' },
    }))
  }),
)
