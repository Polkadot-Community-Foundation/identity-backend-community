import type { SpanContext } from '@opentelemetry/api'
import { Effect } from 'effect'

/**
 * Validate SpanContext fields per W3C Trace Context spec.
 * @see https://www.w3.org/TR/trace-context/#trace-id
 * @see https://www.w3.org/TR/trace-context/#parent-id
 * @see https://www.w3.org/TR/trace-context/#trace-flags
 */
const isValidSpanContext = (spanContext: SpanContext): boolean => {
  const traceIdRegex = /^[0-9a-f]{32}$/i
  if (!traceIdRegex.test(spanContext.traceId)) {
    return false
  }

  const spanIdRegex = /^[0-9a-f]{16}$/i
  if (!spanIdRegex.test(spanContext.spanId)) {
    return false
  }

  if (spanContext.traceFlags !== 0 && spanContext.traceFlags !== 1) {
    return false
  }

  return true
}

export const bridgeSpanContext = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  honoContext: {
    get: (key: string) => SpanContext | undefined | null
  },
): Effect.Effect<A, E, R> => {
  const spanContext = honoContext.get('spanContext')

  if (!spanContext) {
    return effect
  }

  if (!isValidSpanContext(spanContext)) {
    return effect
  }

  return Effect.gen(function*() {
    const { withSpanContext } = yield* Effect.promise(() => import('@effect/opentelemetry/Tracer'))

    return yield* withSpanContext(effect, spanContext)
  })
}
