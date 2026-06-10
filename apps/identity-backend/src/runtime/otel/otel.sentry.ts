import { DEPLOYMENT_ENVIRONMENT, OTEL_SERVICE_NAME, SENTRY_TRACE_SAMPLE_RATE } from '#root/config.js'
import { TokenBucketRateLimiter } from '#root/infrastructure/token-bucket-rate-limiter.service.js'
import { decideErrorReport } from '#root/lib/request-error.js'
import { NodeSdk } from '@effect/opentelemetry'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import type { ErrorEvent, EventHint } from '@sentry/bun'
import { SentrySampler, SentrySpanProcessor } from '@sentry/opentelemetry'
import { Config, Effect, Exit, Layer, Match, pipe, Runtime } from 'effect'

const parsePathname = (url: string): string | undefined => {
  try {
    return new URL(url).pathname
  } catch {
    return undefined
  }
}

export const layerSentryOTEL = (dsn: string) =>
  Layer.unwrapEffect(
    Effect.gen(function*() {
      const limiter = yield* TokenBucketRateLimiter
      const rt = yield* Effect.runtime<TokenBucketRateLimiter>()

      const beforeSend = async (event: ErrorEvent, hint: EventHint): Promise<ErrorEvent | null> => {
        const pathname = parsePathname(event.request?.url ?? '')
        const decision = decideErrorReport(hint.originalException, pathname ?? '')

        const fingerprint = Match.value(decision).pipe(
          Match.tag('RateLimitEvent', (d) => d.fingerprint),
          Match.orElse((): readonly string[] => []),
        )

        if (fingerprint.length > 0) {
          event.fingerprint = [...fingerprint]
          const exit = await pipe(
            limiter.tryConsume(['sentry', ...fingerprint]),
            Effect.exit,
            Runtime.runPromise(rt),
          )
          return Exit.isSuccess(exit) && exit.value ? event : null
        }

        return Match.value(decision).pipe(
          Match.tag('DropEvent', () => null),
          Match.tag('ReportEvent', () => event),
          Match.orElse(() => null),
        )
      }

      const Sentry = yield* Effect.promise(() => import('@sentry/bun'))

      const [serviceName, environment, tracesSampleRate] = yield* pipe(
        Config.all([
          OTEL_SERVICE_NAME,
          DEPLOYMENT_ENVIRONMENT.pipe(Config.map((s) => s ?? Bun.env.NODE_ENV)),
          SENTRY_TRACE_SAMPLE_RATE,
        ]),
      )

      yield* Effect.try(() =>
        Sentry.init({
          dsn,
          environment,
          tracesSampleRate,
          skipOpenTelemetrySetup: true,
          traceLifecycle: 'stream',
          integrations: [Sentry.spanStreamingIntegration()],
          beforeSend,
        })
      ).pipe(Effect.orDie)

      const client = yield* Effect.sync(() => Sentry.getClient()).pipe(
        Effect.filterOrDieMessage(
          (client): client is NonNullable<typeof client> => client !== undefined,
          'Sentry client not initialized after successful init',
        ),
      )

      const { setupEventContextTrace } = yield* Effect.promise(() => import('@sentry/opentelemetry'))
      yield* Effect.sync(() => setupEventContextTrace(client))

      return NodeSdk.layer(() => ({
        resource: { serviceName },
        metricReader: new PrometheusExporter(),
        spanProcessor: new SentrySpanProcessor(),
        tracerConfig: {
          sampler: new SentrySampler(client),
        },
      } satisfies NodeSdk.Configuration))
    }).pipe(Effect.provide(TokenBucketRateLimiter.Default)),
  )
