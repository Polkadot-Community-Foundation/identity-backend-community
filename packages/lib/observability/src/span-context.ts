import type { SpanContext } from '@opentelemetry/api'
import { Effect, Schema as S } from 'effect'
import { SpanId, TraceId } from './trace-context.schema.js'

const isTraceId = S.is(TraceId)
const isSpanId = S.is(SpanId)

export const isValidSpanContext = (spanContext: SpanContext): boolean =>
  isTraceId(spanContext.traceId) &&
  isSpanId(spanContext.spanId) &&
  (spanContext.traceFlags === 0 || spanContext.traceFlags === 1)

export const bridgeSpanContext = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  honoContext: {
    get: (key: string) => SpanContext | undefined | null
  },
): Effect.Effect<A, E, R> => {
  const spanContext = honoContext.get('spanContext')

  if (!spanContext || !isValidSpanContext(spanContext)) {
    return effect
  }

  return Effect.gen(function*() {
    const { withSpanContext } = yield* Effect.promise(() => import('@effect/opentelemetry/Tracer'))

    return yield* withSpanContext(effect, spanContext)
  })
}
