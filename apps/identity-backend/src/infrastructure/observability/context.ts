import { Cause, Context, Effect, Layer, PubSub } from 'effect'
import type { Span } from 'effect/Tracer'

export interface ExceptionEvent {
  readonly cause: Cause.Cause<unknown>
  readonly span?: Span
}

export namespace DefectPubSub {
  export type Definition = PubSub.PubSub<ExceptionEvent>
}

export class DefectPubSub extends Context.Tag('identity-backend-container/infrastructure/observability/DefectPubSub')<
  DefectPubSub,
  DefectPubSub.Definition
>() {}

export namespace DefectReporter {
  export interface Definition {
    captureException(cause: Cause.Cause<unknown>, options?: { readonly span?: Span }): Effect.Effect<void, never, never>
  }
}

export class DefectReporter
  extends Context.Tag('identity-backend-container/infrastructure/observability/DefectReporter')<
    DefectReporter,
    DefectReporter.Definition
  >()
{
  static NoOp: Layer.Layer<DefectReporter, never, never> = Layer.succeed(
    DefectReporter,
    DefectReporter.of({
      captureException: () => Effect.void,
    }),
  )
}
