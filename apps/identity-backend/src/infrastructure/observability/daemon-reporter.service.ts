import { DaemonReporter } from '@identity-backend/effect-daemon-spec'
import { Effect, Layer } from 'effect'
import { DefectReporter } from './context.js'

const make = Effect.gen(function*() {
  const reporter = yield* DefectReporter

  const onSupervisorFailure = (Effect.fnUntraced(function*(_name, cause) {
    yield* reporter.captureException(cause)
  })) satisfies DaemonReporter['Type']['onRestart']

  return DaemonReporter.of({
    onRestart: onSupervisorFailure,
    onExhausted: onSupervisorFailure,
  })
})

export const DaemonReporterLive = Layer.effect(DaemonReporter, make)
