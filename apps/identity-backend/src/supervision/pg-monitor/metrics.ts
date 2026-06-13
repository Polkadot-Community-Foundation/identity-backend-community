import { Metric } from 'effect'

const withPgMonitorTag = <Type, In, Out>(metric: Metric.Metric<Type, In, Out>) =>
  Metric.tagged(metric, 'daemon', 'pg-monitor')

export const poolConnectionsOpenedTotal = withPgMonitorTag(
  Metric.counter('app.db.pool.connections_opened_total', {
    description: 'PostgreSQL socket connections opened since process start',
  }),
)

export const poolConnectionsClosedTotal = withPgMonitorTag(
  Metric.counter('app.db.pool.connections_closed_total', {
    description: 'PostgreSQL socket connections closed since process start',
  }),
)

export const sessionsTotal = withPgMonitorTag(
  Metric.gauge('app.db.pool.sessions_total', {
    description: 'Total sessions visible in pg_stat_activity for this database',
  }),
)

export const sessionsActive = withPgMonitorTag(
  Metric.gauge('app.db.pool.sessions_active', {
    description: 'Sessions in the active state in pg_stat_activity',
  }),
)

export const sessionsIdle = withPgMonitorTag(
  Metric.gauge('app.db.pool.sessions_idle', {
    description: 'Sessions in the idle state in pg_stat_activity',
  }),
)

export const sessionsIdleInTransaction = withPgMonitorTag(
  Metric.gauge('app.db.pool.sessions_idle_in_transaction', {
    description: 'Sessions in the idle in transaction state in pg_stat_activity',
  }),
)

export const sessionsWaitingLock = withPgMonitorTag(
  Metric.gauge('app.db.pool.sessions_waiting_lock', {
    description: 'Sessions blocked waiting on a lock in pg_stat_activity',
  }),
)

export const cacheHitRatio = withPgMonitorTag(
  Metric.gauge('app.db.cache.hit_ratio', {
    description: 'PostgreSQL buffer cache hit ratio (blks_hit / (blks_hit + blks_read))',
  }),
)

export const deadlocks = withPgMonitorTag(
  Metric.gauge('app.db.deadlocks', {
    description: 'Deadlocks detected by PostgreSQL since stats reset',
  }),
)

export const databaseSizeBytes = withPgMonitorTag(
  Metric.gauge('app.db.database.size_bytes', {
    description: 'Database size on disk in bytes (pg_database_size)',
  }),
)

export const serverMaxConnections = withPgMonitorTag(
  Metric.gauge('app.db.server.max_connections', {
    description: 'PostgreSQL server max_connections setting',
  }),
)

export const serverConnections = withPgMonitorTag(
  Metric.gauge('app.db.server.connections', {
    description: 'Current connection count on the PostgreSQL server across all databases',
  }),
)

export const lastSuccessfulPollTimestamp = withPgMonitorTag(
  Metric.gauge('app.db.health.last_successful_poll_timestamp', {
    description: 'Unix timestamp of the last successful pg-monitor poll',
  }),
)

export const decodeFailuresTotal = withPgMonitorTag(
  Metric.counter('app.db.health.decode_failures_total', {
    description: 'Total number of pg-monitor decode failures',
  }),
)
