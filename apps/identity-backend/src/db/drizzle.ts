import { DB } from '@identity-backend/db'
import { relations } from '@identity-backend/db/Relations'
import { Config, Context, Duration, Effect, Layer, Metric, pipe, Redacted } from 'effect'
import net from 'node:net'

import { poolConnectionsClosedTotal, poolConnectionsOpenedTotal } from '#root/supervision/pg-monitor/metrics.js'

import * as schema from './schema.js'

export class DBLiveConfig extends Context.Tag('DBLiveConfig')<DBLiveConfig, {
  databaseUrl: Redacted.Redacted<string>
}>() {}

export class WebDbPoolConfig extends Context.Reference<WebDbPoolConfig>()(
  'WebDbPoolConfig',
  {
    defaultValue: () => ({
      max: 25,
      idleTimeout: Duration.seconds(45),
      maxLifetime: Duration.minutes(12),
      connectTimeout: Duration.seconds(12),
      keepAlive: Duration.seconds(30),
      socketTimeout: Duration.seconds(30),
      statementTimeout: Duration.seconds(30),
      lockTimeout: Duration.seconds(5),
      idleInTransactionTimeout: Duration.seconds(60),
    }),
  },
) {}

const recordSocketMetric = (metric: Metric.Metric.Counter<number>): void => {
  try {
    Effect.runSync(Metric.increment(metric))
  } catch {
  }
}

export const makeSocketFactory = (timeoutMs: number) => async (opts: { host: string[]; port: number[] }) => {
  const [host] = opts.host
  const [port] = opts.port
  if (host === undefined || port === undefined) {
    throw new Error('postgres socket factory: missing host or port')
  }

  const { promise, resolve, reject } = Promise.withResolvers<net.Socket>()
  const socket = new net.Socket()
  let didOpen = false
  socket.setTimeout(timeoutMs)
  socket.on('timeout', () => socket.destroy())
  socket.on('error', reject)
  socket.on('close', () => {
    if (didOpen) {
      recordSocketMetric(poolConnectionsClosedTotal)
    }
  })
  socket.connect(port, host, () => {
    didOpen = true
    recordSocketMetric(poolConnectionsOpenedTotal)
    socket.off('error', reject)
    resolve(socket)
  })
  return promise
}

export const DBLiveWithoutDependencies = Layer.scoped(
  DB,
  Effect.gen(function*() {
    const { drizzle } = yield* Effect.promise(() => import('drizzle-orm/postgres-js'))
    const postgres = yield* Effect.promise(() => import('postgres')).pipe(Effect.map((mod) => mod.default))
    const config = yield* DBLiveConfig
    const poolConfig = yield* WebDbPoolConfig

    const client = yield* Effect.acquireRelease(
      Effect.sync(() =>
        postgres(
          Redacted.value(config.databaseUrl),
          Object.assign({
            max: poolConfig.max,
            idle_timeout: Duration.toSeconds(poolConfig.idleTimeout),
            max_lifetime: Duration.toSeconds(poolConfig.maxLifetime),
            connect_timeout: Duration.toSeconds(poolConfig.connectTimeout),
            keep_alive: Duration.toSeconds(poolConfig.keepAlive),
            connection: {
              statement_timeout: Duration.toMillis(poolConfig.statementTimeout),
              lock_timeout: Duration.toMillis(poolConfig.lockTimeout),
              idle_in_transaction_session_timeout: Duration.toMillis(poolConfig.idleInTransactionTimeout),
            },
          }, { socket: makeSocketFactory(Duration.toMillis(poolConfig.socketTimeout)) }),
        )
      ),
      (c) => Effect.promise(() => c.end()),
    )

    const db = yield* Effect.sync(() => drizzle({ client, schema, relations }))

    return db
  }),
)

export const DBLive = pipe(
  DBLiveWithoutDependencies,
  Layer.provide(Layer.effect(
    DBLiveConfig,
    Effect.gen(function*() {
      const { DATABASE_URL } = yield* Effect.promise(() => import('#root/config.js'))
      const { databaseUrl } = yield* Config.all({ databaseUrl: DATABASE_URL })
      return {
        databaseUrl: Redacted.make(databaseUrl),
      } satisfies DBLiveConfig['Type']
    }),
  )),
  Layer.provide(Layer.effect(
    WebDbPoolConfig,
    Effect.gen(function*() {
      const {
        DB_POOL_MAX,
        DB_POOL_IDLE_TIMEOUT,
        DB_POOL_MAX_LIFETIME,
        DB_POOL_CONNECT_TIMEOUT,
        DB_POOL_KEEP_ALIVE,
        DB_POOL_SOCKET_TIMEOUT,
        DB_STATEMENT_TIMEOUT,
        DB_LOCK_TIMEOUT,
        DB_IDLE_IN_TRANSACTION_TIMEOUT,
      } = yield* Effect.promise(() => import('#root/config.js'))
      const poolConfig = yield* Config.all({
        max: DB_POOL_MAX,
        idleTimeout: DB_POOL_IDLE_TIMEOUT,
        maxLifetime: DB_POOL_MAX_LIFETIME,
        connectTimeout: DB_POOL_CONNECT_TIMEOUT,
        keepAlive: DB_POOL_KEEP_ALIVE,
        socketTimeout: DB_POOL_SOCKET_TIMEOUT,
        statementTimeout: DB_STATEMENT_TIMEOUT,
        lockTimeout: DB_LOCK_TIMEOUT,
        idleInTransactionTimeout: DB_IDLE_IN_TRANSACTION_TIMEOUT,
      })
      return poolConfig satisfies WebDbPoolConfig['Type']
    }),
  )),
)

export const DBTest = Layer.scoped(
  DB,
  Effect.gen(function*() {
    const { drizzle } = yield* Effect.promise(() => import('drizzle-orm/pglite'))
    const { PGlite } = yield* Effect.promise(() => import('@electric-sql/pglite'))
    const { migrate } = yield* Effect.promise(() => import('drizzle-orm/pglite/migrator'))
    const { migrationsFolder } = yield* Effect.promise(() => import('../../lib/paths.js'))

    const pglite = yield* Effect.acquireRelease(
      Effect.sync(() => new PGlite()),
      (c) => Effect.promise(() => c.close()),
    )

    const db = yield* Effect.sync(() => drizzle({ client: pglite, schema, relations }))

    yield* Effect.tryPromise(() => migrate(db, { migrationsFolder })).pipe(Effect.orDie)

    return db
  }),
)

export { DB }
