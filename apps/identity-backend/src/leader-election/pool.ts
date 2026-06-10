import { layerFromPool, PgClient } from '@effect/sql-pg/PgClient'
import type { PgClient as PgClientType } from '@effect/sql-pg/PgClient'
import { Config, Context, Duration, Effect, Layer, pipe, Redacted } from 'effect'
import * as Pg from 'pg'

export class LeaderElectionDb extends Context.Tag('LeaderElectionDb')<LeaderElectionDb, PgClientType>() {}

export class LeaderElectionDbConfig extends Context.Tag('LeaderElectionDbConfig')<LeaderElectionDbConfig, {
  databaseUrl: Redacted.Redacted<string>
  maxConnections: number
  idleTimeout: Duration.Duration
  connectTimeout: Duration.Duration
  keepalivesIdle: Duration.Duration
}>() {}

export const LeaderElectionDbLiveWithoutDependencies = Layer.unwrapEffect(
  Effect.gen(function*() {
    const config = yield* LeaderElectionDbConfig
    return pipe(
      layerFromPool({
        acquire: Effect.acquireRelease(
          Effect.sync(() => {
            const pool = new Pg.Pool({
              connectionString: Redacted.value(config.databaseUrl),
              max: config.maxConnections,
              idleTimeoutMillis: Duration.toMillis(config.idleTimeout),
              connectionTimeoutMillis: Duration.toMillis(config.connectTimeout),
              keepAlive: true,
              keepAliveInitialDelayMillis: Duration.toMillis(config.keepalivesIdle),
            })
            // Load-bearing: without an 'error' listener, pg.Pool crashes the process when an idle
            // connection drops (NAT/partition). Recovery is the reaper's job — log and swallow.
            pool.on('error', (cause) => Effect.runFork(Effect.logWarning('LeaderElectionDb pool client error', cause)))
            return pool
          }),
          (pool) => Effect.promise(() => pool.end()).pipe(Effect.orDie),
        ),
      }),
      Layer.map((ctx) => Context.make(LeaderElectionDb, Context.get(ctx, PgClient))),
    )
  }),
)

export const LeaderElectionDbLive = Layer.unwrapEffect(
  Effect.gen(function*() {
    const cfg = yield* Effect.promise(() => import('#root/config.js'))
    const { databaseUrl } = yield* Config.all({ databaseUrl: cfg.DATABASE_URL })

    return pipe(
      LeaderElectionDbLiveWithoutDependencies,
      Layer.provide(
        Layer.effect(
          LeaderElectionDbConfig,
          Config.all({
            databaseUrl: Config.succeed(Redacted.make(databaseUrl)),
            maxConnections: cfg.LEADER_DB_POOL_MAX,
            idleTimeout: cfg.LEADER_DB_POOL_IDLE_TIMEOUT,
            connectTimeout: cfg.LEADER_DB_POOL_CONNECT_TIMEOUT,
            keepalivesIdle: cfg.LEADER_DB_KEEPALIVES_IDLE,
          }),
        ),
      ),
    )
  }),
)
