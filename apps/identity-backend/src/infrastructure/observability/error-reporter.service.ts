import { Effect, Layer, PubSub } from 'effect'
import { DefectPubSub, DefectReporter } from './context'

const make = Effect.gen(function*() {
  const pubsub = yield* DefectPubSub

  const captureException = (Effect.fnUntraced(function*(cause, options) {
    const currentSpan = options?.span ?? (yield* Effect.currentSpan.pipe(Effect.orElse(() => Effect.succeed(null))))

    yield* PubSub.publish(pubsub, { cause, ...(currentSpan ? { span: currentSpan } : {}) })
  })) satisfies DefectReporter['Type']['captureException']

  return DefectReporter.of({
    captureException,
  })
})

export const DefectReporterLive = Layer.effect(DefectReporter, make)
