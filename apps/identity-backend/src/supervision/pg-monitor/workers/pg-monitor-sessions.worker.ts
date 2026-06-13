import { Daemon } from '@identity-backend/effect-daemon-spec'
import { sql } from 'drizzle-orm'
import { Context, Duration, Effect, Metric, Schedule, Schema as S } from 'effect'

import { EffectSQLDb } from '#root/db/effect-sql-db.js'

import { ServerConnectionsFromRaw, SessionsFromRaw } from '../decode-pg-stats.acl.js'
import {
  decodeFailuresTotal,
  serverConnections,
  sessionsActive,
  sessionsIdle,
  sessionsIdleInTransaction,
  sessionsTotal,
  sessionsWaitingLock,
} from '../metrics.js'

export interface PgMonitorSessionsRuntimeConfig {
  readonly interval: Duration.Duration
  readonly tickTimeout: Duration.Duration
}

export class PgMonitorSessionsConfig extends Context.Reference<PgMonitorSessionsConfig>()(
  'identity-backend-container/PgMonitorSessionsConfig',
  {
    defaultValue: (): PgMonitorSessionsRuntimeConfig => ({
      interval: Duration.minutes(1),
      tickTimeout: Duration.seconds(10),
    }),
  },
) {}

const sessionBreakdownQuery = sql`
  SELECT
    count(*)::text AS total,
    count(*) FILTER (WHERE state = 'active')::text AS active,
    count(*) FILTER (WHERE state = 'idle')::text AS idle,
    count(*) FILTER (WHERE state = 'idle in transaction')::text AS idle_in_transaction,
    count(*) FILTER (WHERE wait_event_type = 'Lock')::text AS waiting
  FROM pg_stat_activity
  WHERE backend_type = 'client backend'
`

const serverConnectionsQuery = sql`
  SELECT COALESCE(sum(numbackends)::text, '0') AS total_connections
  FROM pg_stat_database
  WHERE datname IS NOT NULL
`

const queryRetry = Schedule.jittered(Schedule.exponential(Duration.millis(200)))

type Row = Readonly<Record<string, unknown>>

const runQuery = (
  db: EffectSQLDb['Type'],
  query: ReturnType<typeof sql>,
): Effect.Effect<ReadonlyArray<Row>, unknown> => db.execute<Row>(query)

const decodeSessions = S.decodeUnknownEither(SessionsFromRaw)
const decodeServerConnections = S.decodeUnknownEither(ServerConnectionsFromRaw)

export const makePgMonitorSessionsWorker = Effect.gen(function*() {
  const db = yield* EffectSQLDb
  const config = yield* PgMonitorSessionsConfig

  const work = Effect.gen(function*() {
    const sessionsRows = yield* runQuery(db, sessionBreakdownQuery)
    const serverRows = yield* runQuery(db, serverConnectionsQuery)

    const sessions = yield* decodeSessions(sessionsRows).pipe(
      Effect.tapError((cause) =>
        Metric.increment(decodeFailuresTotal).pipe(
          Effect.zipRight(Effect.logWarning('PgMonitor sessions decode failed', cause)),
        )
      ),
    )
    const server = yield* decodeServerConnections(serverRows).pipe(
      Effect.tapError((cause) =>
        Metric.increment(decodeFailuresTotal).pipe(
          Effect.zipRight(Effect.logWarning('PgMonitor server_connections decode failed', cause)),
        )
      ),
    )

    yield* Metric.set(sessionsTotal, sessions.sessionsTotal)
    yield* Metric.set(sessionsActive, sessions.sessionsActive)
    yield* Metric.set(sessionsIdle, sessions.sessionsIdle)
    yield* Metric.set(sessionsIdleInTransaction, sessions.sessionsIdleInTransaction)
    yield* Metric.set(sessionsWaitingLock, sessions.sessionsWaitingLock)
    yield* Metric.set(serverConnections, server.totalConnections)
  })

  return Daemon.poll({
    name: 'pg-monitor-sessions',
    work,
    interval: config.interval,
    tick: {
      spanName: 'pg_monitor.sessions_cycle',
      tickTimeout: config.tickTimeout,
    },
    tickHooks: { innerRetry: queryRetry },
    lock: { mode: 'none' },
  })
})
