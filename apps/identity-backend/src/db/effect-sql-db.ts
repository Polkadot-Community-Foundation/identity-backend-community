import { PgClient } from '@effect/sql-pg'
import * as PgDrizzle from 'drizzle-orm/effect-postgres'
import { Config, Context, Duration, Effect, identity, Layer, pipe, Redacted } from 'effect'

import * as schema from './schema.js'

export class EffectSQLDb extends Context.Tag('EffectSQLDb')<EffectSQLDb, PgDrizzle.EffectPgDatabase<typeof schema>>() {}

export class EffectSQLDbConfig extends Context.Tag('EffectSQLDbConfig')<EffectSQLDbConfig, {
  databaseUrl: Redacted.Redacted<string>
}>() {}

export class EffectSQLDbPoolConfig extends Context.Reference<EffectSQLDbPoolConfig>()(
  'EffectSQLDbPoolConfig',
  {
    defaultValue: () => ({
      maxConnections: 15,
      idleTimeout: Duration.seconds(30),
      connectTimeout: Duration.seconds(12),
    }),
  },
) {}

export const EffectSQLDbLiveWithoutDependencies = Layer.unwrapEffect(
  Effect.gen(function*() {
    const config = yield* EffectSQLDbConfig
    const poolConfig = yield* EffectSQLDbPoolConfig
    const { types } = yield* Effect.promise(() => import('pg'))

    const pgClientLayer = PgClient.layer({
      url: config.databaseUrl,
      types: {
        getTypeParser: (typeId, format) => {
          // Return raw values for date/time types to let Drizzle handle parsing
          if ([1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182].includes(typeId)) {
            return identity
          }
          return types.getTypeParser(typeId, format)
        },
      },
      maxConnections: poolConfig.maxConnections,
      idleTimeout: poolConfig.idleTimeout,
      connectTimeout: poolConfig.connectTimeout,
    })

    const dbLayer = Layer.effect(
      EffectSQLDb,
      PgDrizzle.makeWithDefaults({ schema }),
    )

    return Layer.provideMerge(dbLayer, pgClientLayer)
  }),
)

export const EffectSQLDbLive = pipe(
  EffectSQLDbLiveWithoutDependencies,
  Layer.provide(Layer.effect(
    EffectSQLDbConfig,
    Effect.gen(function*() {
      const { DATABASE_URL } = yield* Effect.promise(() => import('#root/config.js'))
      const { databaseUrl } = yield* Config.all({ databaseUrl: DATABASE_URL })
      return {
        databaseUrl: Redacted.make(databaseUrl),
      } satisfies EffectSQLDbConfig['Type']
    }),
  )),
  Layer.provide(Layer.effect(
    EffectSQLDbPoolConfig,
    Effect.gen(function*() {
      const {
        DB_POOL_MAX,
        DB_POOL_IDLE_TIMEOUT,
        DB_POOL_CONNECT_TIMEOUT,
      } = yield* Effect.promise(() => import('#root/config.js'))
      const poolConfig = yield* Config.all({
        maxConnections: DB_POOL_MAX,
        idleTimeout: DB_POOL_IDLE_TIMEOUT,
        connectTimeout: DB_POOL_CONNECT_TIMEOUT,
      })
      return poolConfig satisfies EffectSQLDbPoolConfig['Type']
    }),
  )),
)
