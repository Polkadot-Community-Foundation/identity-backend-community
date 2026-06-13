import { EffectSQLDbConfig, EffectSQLDbLiveWithoutDependencies } from '#root/db/effect-sql-db.js'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { Effect, Layer, Redacted } from 'effect'

export const EffectSQLDbTest = Layer.unwrapEffect(
  Effect.gen(function*() {
    const pglite = yield* Effect.acquireRelease(
      Effect.sync(() => new PGlite()),
      (db) => Effect.promise(() => db.close()),
    )

    const server = yield* Effect.acquireRelease(
      Effect.promise(() => {
        const srv = new PGLiteSocketServer({ db: pglite, port: 0 })
        return srv.start().then(() => srv)
      }),
      (srv) => Effect.promise(() => srv.stop()),
    )

    const connStr = server.getServerConn()
    const url = connStr.startsWith('postgres')
      ? connStr
      : `postgres://postgres:postgres@${connStr}/postgres`

    const configLayer = Layer.succeed(EffectSQLDbConfig, {
      databaseUrl: Redacted.make(url),
    })

    return Layer.provide(EffectSQLDbLiveWithoutDependencies, configLayer).pipe(Layer.orDie)
  }),
)
