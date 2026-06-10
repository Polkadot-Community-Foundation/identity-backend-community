import { Effect, Layer, pipe, Runtime } from 'effect'

export const layerRx = Layer.effectDiscard(
  Effect.gen(function*() {
    const Rx = yield* Effect.promise(() => import('rxjs'))
    const runtime = yield* Effect.runtime()

    yield* Effect.sync(() => {
      Rx.config.onUnhandledError = (err) => pipe(Effect.logError('rxjs unhandled error', err), Runtime.runSync(runtime))
    })
  }),
)
