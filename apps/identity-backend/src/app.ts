import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import * as PG from '#root/lib/pg-utils.js'
import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { HttpMetricsMiddleware, Logger as HonoLoggingMiddleware } from '#root/middleware/mod.js'
import { Cause, Clock, Config, Context, Effect, Exit, Layer, Match, pipe, Redacted, Runtime, Schedule } from 'effect'
import { basicAuth } from 'hono/basic-auth'
import { getConnInfo, serveStatic } from 'hono/bun'
import { HTTPException } from 'hono/http-exception'
import { requestId } from 'hono/request-id'
import { timing } from 'hono/timing'
import { getPath } from 'hono/utils/url'
import packageJson from '../package.json' with { type: 'json' }
import { DB } from './db/drizzle.js'

import { isProbePath } from '#root/lib/kube.js'
import { decideErrorReport } from '#root/lib/request-error.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { withSpanContext } from '@effect/opentelemetry/Tracer'
export { isProbePath, PROBE_PATHS } from '#root/lib/kube.js'
import { parseTraceparent } from '#root/tracing/traceparent.js'
import { makeAdminRoute } from './routes/admin.routes.js'
import { makeDebugHeapdumpRoute } from './routes/debug-heapdump.routes.js'
import { makeDebugMemoryRoute } from './routes/debug-memory.routes.js'
import { makeDebugQueryRoute } from './routes/debug-query.routes.js'
import * as v1 from './routes/v1/mod.js'

const { version } = packageJson

export class AppConfig extends Context.Tag('@app/AppConfig')<AppConfig, {
  port: number
  swaggerUsername: string
  swaggerPassword: Redacted.Redacted<string>
}>() {}

export const layerAppWithoutDependencies = Effect.gen(function*() {
  const runtime = yield* Effect.runtime<DB>()
  const db = yield* DB
  const defectReporter = yield* DefectReporter
  const config = yield* AppConfig
  const runSync = Runtime.runSync(runtime)
  const honoLoggingMiddleware = yield* HonoLoggingMiddleware
  const httpMetricsMiddleware = yield* HttpMetricsMiddleware

  const app = yield* Effect.sync(() => createOpenAPIHono())

  yield* Effect.sync(() => {
    app.onError((error, c) => {
      const path = getPath(c.req.raw)
      const annotations = {
        method: c.req.method,
        path,
        requestId: c.get('requestId'),
        remoteIp: getConnInfo(c).remote.address,
        userAgent: c.req.header('user-agent'),
      }

      const cause: Cause.Cause<unknown> = Cause.isCause(error) ? error : Cause.fail(error)
      const squashed = Cause.squash(cause)

      const decision = decideErrorReport(squashed, path)

      const shouldReport = Match.value(decision).pipe(
        Match.tag('ReportEvent', () => true),
        Match.orElse(() => false),
      )

      if (shouldReport) {
        runSync(Effect.logError(error).pipe(Effect.annotateLogs(annotations)))
        const spanContext = c.get('spanContext')
        const report = defectReporter.captureException(cause)

        const effect = spanContext ? withSpanContext(report, spanContext) : report

        void Runtime.runPromise(runtime)(effect).catch(() => void 0)
      }

      if (squashed instanceof HTTPException) {
        return squashed.getResponse()
      }

      return c.json({ error: 'Oops! Something went wrong.' }, 500)
    })

    app.get(
      '/api/swagger/json',
      basicAuth({
        username: config.swaggerUsername,
        password: Redacted.value(config.swaggerPassword),
      }),
      (c) => {
        app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from platform attestation',
        })

        const document = app.getOpenAPI31Document(
          {
            openapi: '3.1.0',
            info: {
              title: 'Identity Backend API',
              version: version,
              description: 'Development Documentation',
            },
            servers: [
              { url: 'http://localhost:3000', description: 'Local development' },
            ],
          },
        )

        return c.json(document)
      },
    )

    app.get('/healthcheck', async (c) => {
      const result = await Effect.gen(function*() {
        const [now] = yield* Effect.all(
          [
            Clock.currentTimeMillis,
            PG.ping(db),
          ],
          { concurrency: 'unbounded' },
        )

        return {
          uptime: yield* Effect.sync(() => process.uptime()),
          responseTime: yield* Effect.sync(() => process.hrtime()),
          message: 'OK',
          timestamp: now,
        }
      }).pipe(
        withRouteTimeout,
        Effect.exit,
        Runtime.runPromise(runtime),
      )

      if (Exit.isFailure(result)) {
        throw result.cause
      }

      return c.json(result.value, 200)
    })

    app.get('/livez', async (c) => {
      const result = await Effect.gen(function*() {
        return yield* Effect.sync(() => ({ status: 'ok' as const, uptime: process.uptime() }))
      }).pipe(
        withRouteTimeout,
        Effect.exit,
        Runtime.runPromise(runtime),
      )

      if (Exit.isFailure(result)) {
        throw result.cause
      }

      return c.json(result.value, 200)
    })

    app.get('/readyz', async (c) => {
      const result = await pipe(
        Effect.gen(function*() {
          yield* PG.ping(db)
          return { status: 'ok' }
        }),
        withRouteTimeout,
        Effect.exit,
        Runtime.runPromise(runtime),
      )

      if (Exit.isFailure(result)) {
        return c.json({ status: 'error', message: 'Database unavailable' }, 503)
      }

      return c.json(result.value, 200)
    })

    app.use(timing())
    app.use('*', requestId())
    app.use('*', async (c, next) => {
      const traceparent = c.req.header('traceparent')

      if (traceparent) {
        const spanContext = parseTraceparent(traceparent)

        if (spanContext) {
          c.set('spanContext', spanContext)
        }
      }

      await next()
    })
    app.use('*', honoLoggingMiddleware)
    app.use('*', httpMetricsMiddleware)
  })

  const adminRoute = yield* makeAdminRoute
  const debugHeapdumpRoute = yield* makeDebugHeapdumpRoute
  const debugMemoryRoute = yield* makeDebugMemoryRoute
  const debugQueryRoute = yield* makeDebugQueryRoute

  app.route('/admin', adminRoute)
  app.route('/debug/heapdump', debugHeapdumpRoute)
  app.route('/debug/memory', debugMemoryRoute)
  app.route('/debug/query', debugQueryRoute)

  yield* v1.makeRoutes(app)

  app.get(
    '*',
    serveStatic({
      root: './static',
      rewriteRequestPath: (path) => {
        if (path === '/') return '/index.html'
        if (path.startsWith('/api/') || path.startsWith('/rpc')) return path
        if (path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) return path
        return '/index.html'
      },
    }),
  )

  const server = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ port: config.port, fetch: app.fetch })),
    (s) => Effect.sync(() => s.stop()),
  )

  yield* Effect.log(`Server is running: ${server.url}`)

  return yield* Effect.never
}).pipe(
  Effect.scoped,
  Effect.tapError(Effect.logError),
  Effect.retry({
    schedule: Schedule.forever,
  }),
  Effect.fork,
  Layer.effectDiscard,
)

export const layerApp = layerAppWithoutDependencies.pipe(
  Layer.provide(
    Layer.effect(
      AppConfig,
      Effect.gen(function*() {
        const { PORT, SWAGGER_USERNAME, SWAGGER_PASSWORD } = yield* Effect.promise(() => import('#root/config.js'))

        return ((yield* Config.all({
          port: PORT,
          swaggerUsername: SWAGGER_USERNAME,
          swaggerPassword: SWAGGER_PASSWORD,
        })) satisfies AppConfig['Type'])
      }),
    ),
  ),
)
