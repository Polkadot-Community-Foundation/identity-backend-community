import { type Cause, type Duration, Effect, Metric, Schedule } from 'effect'
import { dual } from 'effect/Function'

export const supervisorRestartsCounter = Metric.counter(
  'app.daemon.supervisor.restart',
  { description: 'Daemon supervisor restart count' },
)

export const supervisorExhaustionsCounter = Metric.counter(
  'app.daemon.supervisor.exhaustion',
  { description: 'Daemon supervisor exhaustion count' },
)

export interface SupervisedLoopConfig {
  readonly name: string
  readonly maxRestarts: number
  readonly backoff: Schedule.Schedule<Duration.Duration>
  readonly cooldown: Duration.DurationInput
  readonly onRestart?: (cause: Cause.Cause<unknown>) => Effect.Effect<void>
  readonly onExhausted?: (cause: Cause.Cause<unknown>) => Effect.Effect<void>
}

export const withSupervision: {
  (config: SupervisedLoopConfig): <A, E, R>(body: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(body: Effect.Effect<A, E, R>, config: SupervisedLoopConfig): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(body: Effect.Effect<A, E, R>, config: SupervisedLoopConfig): Effect.Effect<A, E, R> =>
    body.pipe(
      Effect.tapErrorCause((cause) =>
        Effect.gen(function*() {
          yield* Effect.logWarning(`daemon.${config.name} tick failed; will restart`, { cause })
          yield* Metric.increment(Metric.tagged(supervisorRestartsCounter, 'daemon', config.name))
          if (config.onRestart) yield* config.onRestart(cause)
        })
      ),
      Effect.retry(config.backoff.pipe(Schedule.compose(Schedule.recurs(config.maxRestarts)))),
      Effect.tapErrorCause((cause) =>
        Effect.gen(function*() {
          yield* Effect.logError(
            `daemon.${config.name} restart budget exhausted; cooling down before retry`,
            { cause },
          )
          yield* Metric.increment(Metric.tagged(supervisorExhaustionsCounter, 'daemon', config.name))
          if (config.onExhausted) yield* config.onExhausted(cause)
        })
      ),
      Effect.retry(Schedule.spaced(config.cooldown)),
    ),
)
