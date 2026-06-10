import { SENTRY_DSN } from '#root/config.js'
import { Effect, Layer } from 'effect'

export const layerOTEL = Layer.unwrapEffect(
  Effect.gen(function*() {
    const dsn = yield* SENTRY_DSN

    if (dsn) {
      const { layerSentryOTEL } = yield* Effect.promise(() => import('./otel.sentry.js'))
      return layerSentryOTEL(dsn)
    }

    const { layerOTLPOnly } = yield* Effect.promise(() => import('./otel.otlp.js'))
    return layerOTLPOnly
  }),
)
