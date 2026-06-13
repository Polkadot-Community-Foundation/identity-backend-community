import type { HttpBindings } from '@hono/node-server'
import { Clock, Context, Effect, Exit, HashSet, identity, Layer, pipe, Runtime } from 'effect'
import type * as hono from 'hono'
import type * as connInfo from 'hono/conninfo'
import type * as requestId from 'hono/request-id'

export namespace GetConnInfo {
  export type GetConnInfo = connInfo.GetConnInfo
}

export class GetConnInfo extends Context.Tag(
  '@identity-backend/middleware/logger/GetConnInfo',
)<GetConnInfo, GetConnInfo.GetConnInfo>() {
  static readonly Default = Layer.effect(
    GetConnInfo,
    Effect.gen(function*() {
      const { getConnInfo } = yield* Effect.promise(() => import('hono/bun'))
      return getConnInfo
    }),
  )
}

export namespace LoggerConfig {
  export type RequestIdVariables = requestId.RequestIdVariables

  export type Context = hono.Context<{
    Bindings: HttpBindings
    Variables: Partial<RequestIdVariables>
  }>
  export interface LoggerConfig {
    additionalHeaders?: HashSet.HashSet<string>
    makeIncomingMessage: (c: Context) => Effect.Effect<string, never, never>
    makeOutgoingMessage: (c: Context) => Effect.Effect<string, never, never>
    makeShouldLog?: (c: Context) => Effect.Effect<boolean, never, never>
  }
}

export class LoggerConfig extends Context.Tag(
  '@identity-backend/middleware/logger/LoggerConfig',
)<LoggerConfig, LoggerConfig.LoggerConfig>() {}

export namespace Logger {
  export type RequestIdVariables = requestId.RequestIdVariables

  export type Service = hono.MiddlewareHandler<{
    Bindings: HttpBindings
    Variables: Partial<RequestIdVariables>
  }>
}

type Service = Logger.Service

export class Logger extends Effect.Service<Logger>()(
  '@identity-backend/middleware/logger/Logger',
  {
    effect: Effect.gen(function*() {
      const runtime = yield* Effect.runtime()
      const getConnInfo = yield* GetConnInfo
      const config = yield* LoggerConfig
      const { getPath } = yield* Effect.promise(() => import('hono/utils/url'))

      return (async (c, next) => {
        const result = await Effect.gen(function*() {
          const shouldLog = yield* config.makeShouldLog?.(c) ??
            Effect.succeed(true)

          const goNext = Effect.tryPromise({
            try: () => next(),
            catch: identity,
          })

          if (!shouldLog) {
            return yield* goNext
          }

          const start = yield* Clock.currentTimeMillis
          yield* Effect.logDebug(yield* config.makeIncomingMessage(c))

          yield* Effect.addFinalizer(() =>
            Effect.gen(function*() {
              const end = yield* Clock.currentTimeMillis
              yield* Effect.logDebug(yield* config.makeOutgoingMessage(c)).pipe(
                Effect.annotateLogs({
                  responseTimeMs: end - start,
                  status: c.res.status ?? Number.NaN,
                }),
              )
            })
          )

          return yield* goNext
        }).pipe(
          Effect.annotateLogs({
            method: c.req.method,
            path: getPath(c.req.raw),
            requestId: c.get('requestId'),
            remoteIp: (
              c.req.header('cf-connecting-ip') ??
                c.req.header('X-Forwarded-For') ??
                getConnInfo(c).remote.address
            )
              ?.split(',')
              ?.map((ip) => ip.trim()),
            userAgent: c.req.header('user-agent'),
            contentType: c.req.header('content-type'),
            contentLength: c.req.header('content-length'),
            referer: c.req.header('referer'),
            host: c.req.header('host'),
            origin: c.req.header('origin'),
            additionalHeaders: config.additionalHeaders
              ? Object.fromEntries(
                Array.from(HashSet.values(config.additionalHeaders)).map(
                  (header) => [header, c.req.header(header)] as const,
                ),
              )
              : undefined,
          }),
          Effect.scoped,
          Effect.exit,
          Runtime.runPromise(runtime),
        )

        if (Exit.isFailure(result)) {
          throw result.cause
        }

        return result.value
      }) satisfies Service as Service
    }),
    dependencies: [
      GetConnInfo.Default,
      Layer.effect(
        LoggerConfig,
        Effect.gen(function*() {
          const { REQUEST_SAMPLE_RATE } = yield* Effect.promise(() => import('#root/config.js'))
          const requestSampleRate = yield* REQUEST_SAMPLE_RATE
          const rng = yield* Effect.random

          return {
            additionalHeaders: HashSet.empty(),
            makeIncomingMessage: () => Effect.succeed('<--- Incoming Request (Sampled)'),
            makeOutgoingMessage: () => Effect.succeed('---> Outgoing Response (Sampled)'),
            makeShouldLog: (c) =>
              pipe(
                Effect.all([rng.next, Effect.succeed(requestSampleRate)] as const),
                Effect.map(([n, sampleRate]) => n < sampleRate && c.req.path.startsWith('/api')),
              ),
          }
        }),
      ),
    ],
  },
) {}
