import { httpRequestDurationHistogram, httpRequestsTotalCounter } from '#root/metrics/http.js'
import { Clock, Duration, Effect, Exit, identity, Metric, MetricLabel, Runtime } from 'effect'
import type * as hono from 'hono'

const EXCLUDED_PATHS = new Set(['/healthcheck', '/livez', '/readyz', '/api/swagger/json'])

export namespace HttpMetricsMiddleware {
  export type Service = hono.MiddlewareHandler
}

type Service = HttpMetricsMiddleware.Service

export class HttpMetricsMiddleware extends Effect.Service<HttpMetricsMiddleware>()(
  '@identity-backend/middleware/http-metrics/HttpMetricsMiddleware',
  {
    effect: Effect.gen(function*() {
      const runtime = yield* Effect.runtime()

      return (async (c, next) => {
        if (EXCLUDED_PATHS.has(c.req.path)) {
          return next()
        }

        const method = c.req.method

        const result = await Effect.gen(function*() {
          const goNext = Effect.tryPromise({
            try: () => next(),
            catch: identity,
          })

          const start = yield* Clock.currentTimeMillis

          yield* Effect.addFinalizer(() =>
            Effect.gen(function*() {
              const end = yield* Clock.currentTimeMillis
              const durationSeconds = Duration.toSeconds(Duration.millis(end - start))

              const route = c.req.routePath && c.req.routePath !== '*' ? c.req.routePath : 'unknown'

              const status = c.res?.status ?? 500

              const labels = [
                MetricLabel.make('method', method),
                MetricLabel.make('route', route),
                MetricLabel.make('status', String(status)),
              ]
              const taggedCounter = Metric.taggedWithLabels(httpRequestsTotalCounter, labels)
              yield* Metric.increment(taggedCounter)

              const histogramLabels = [
                MetricLabel.make('method', method),
                MetricLabel.make('route', route),
              ]
              const taggedHistogram = Metric.taggedWithLabels(
                httpRequestDurationHistogram,
                histogramLabels,
              )
              yield* Metric.update(taggedHistogram, durationSeconds)
            })
          )

          return yield* goNext
        }).pipe(
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
  },
) {}
