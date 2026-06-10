import { Context, Duration, Effect, Schema as S } from 'effect'
import { HTTPException } from 'hono/http-exception'

export class RouteTimeout extends Context.Reference<RouteTimeout>()('RouteTimeout', {
  defaultValue: () => Duration.seconds(32),
}) {}

class RouteTimeoutError extends S.TaggedError<RouteTimeoutError>()('RouteTimeoutError', {
  duration: S.Number,
}) {}

export const withRouteTimeout = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const timeout = yield* RouteTimeout
    return yield* self.pipe(
      Effect.timeoutFail({
        duration: timeout,
        onTimeout: () => new RouteTimeoutError({ duration: Duration.toSeconds(timeout) }),
      }),
      Effect.catchTag('RouteTimeoutError', () =>
        Effect.gen(function*() {
          yield* Effect.annotateCurrentSpan('timeout.duration', Duration.toSeconds(timeout))
          return yield* Effect.die(new HTTPException(504, { message: 'Gateway Timeout' }))
        })),
    )
  })
