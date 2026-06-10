import { Cause, Context, Duration, Effect, Layer, Option, PubSub, Queue, Schedule } from 'effect'
import { DefectPubSub, type ExceptionEvent } from '../context.js'

export class SentryErrorMonitorDaemonConfig
  extends Context.Reference<SentryErrorMonitorDaemonConfig>()('SentryErrorMonitorDaemonConfig', {
    defaultValue: () => ({
      captureExceptionTimeout: Duration.seconds(5),
    }),
  })
{}

export const SentryErrorMonitorDaemon = Layer.scopedDiscard(Effect.gen(function*() {
  const Sentry = yield* Effect.promise(() => import('@sentry/bun'))
  const config = yield* SentryErrorMonitorDaemonConfig
  const pubsub = yield* DefectPubSub
  const rand = yield* Effect.random

  const handleException = Effect.fnUntraced(
    function*(event: ExceptionEvent) {
      const scope = Sentry.getCurrentScope().clone()
      const sampleRand = yield* rand.next

      if (event.span) {
        scope.setPropagationContext({
          traceId: event.span.traceId,
          propagationSpanId: event.span.spanId,
          ...(Option.isSome(event.span.parent) ? { parentSpanId: event.span.parent.value.spanId } : {}),
          sampleRand,
        })
      }

      yield* Effect.try(() => Sentry.captureException(Cause.squash(event.cause), scope))
    },
    Effect.ignoreLogged,
    Effect.timeout(config.captureExceptionTimeout),
    Effect.ignore,
    Effect.forkScoped,
  )

  const exceptionQueue = yield* PubSub.subscribe(pubsub)

  yield* exceptionQueue.pipe(
    Queue.take,
    Effect.tap(handleException),
    Effect.repeat(Schedule.forever),
    Effect.forkScoped,
  )
}))
