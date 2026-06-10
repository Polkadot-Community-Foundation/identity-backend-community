import { BunRuntime } from '@effect/platform-bun'
import { Effect, flow, Layer, Match, pipe, Schedule } from 'effect'
import { layerApp } from './app.js'
import { HealthReporterDaemon } from './features/subscriptions/health.daemon.js'
import { SentryErrorMonitorDaemon } from './infrastructure/observability/sentry/error-monitor.daemon.js'
import { layerRuntime } from './runtime.js'
import { layerDaemonLeaderSupervisor } from './supervision/daemon-leader/mod.js'

const init = Effect.gen(function*() {
  yield* Effect.logInfo(`Environment: ${Bun.env.NODE_ENV ?? 'development'}`)

  yield* SentryErrorMonitorDaemon.pipe(
    Layer.launch,
    Effect.scoped,
    Effect.forkDaemon,
  )
})

const program = Layer.mergeAll(
  Layer.effectDiscard(init),
  layerDaemonLeaderSupervisor,
  layerApp,
  HealthReporterDaemon.Default,
).pipe(
  Layer.provide(layerRuntime),
  Layer.launch,
  Effect.scoped,
  Effect.retry({
    schedule: pipe(
      Schedule.exponential('1 second'),
      Schedule.upTo('30 seconds'),
    ),
    while: flow(
      Match.value,
      Match.tag('ConfigError', () => false),
      Match.orElse(() => true),
    ),
  }),
  Effect.orDie,
  Effect.tagMetrics('environment', Bun.env.NODE_ENV ?? 'development'),
  Effect.tapDefect((c) => Effect.logFatal('FATAL ERROR: An unrecoverable error occurred', c)),
  Effect.asVoid,
)

BunRuntime.runMain(program, {
  disableErrorReporting: true,
  disablePrettyLogger: Bun.env.NODE_ENV === 'production' || !!Bun.env.CI,
})
