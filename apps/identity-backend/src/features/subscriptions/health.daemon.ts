import { DB, schema } from '#root/db/mod.js'
import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { withSupervision } from '#root/lib/daemon-spec.js'
import { and, count, eq, gte } from 'drizzle-orm'
import { Cause, Clock, Context, Duration, Effect, Layer, pipe, Schedule } from 'effect'
import { SpanAttributes } from './telemetry.js'

const { failedPushRecord, pushRecord, pushSubscription, subscriptionRule } = schema

export class HealthReporterConfig extends Context.Reference<HealthReporterConfig>()(
  'HealthReporterConfig',
  {
    defaultValue: () => ({
      reportInterval: Duration.minutes(5),
      extendedReportInterval: Duration.minutes(15),
      retryBaseDelay: Duration.seconds(1),
      retryMaxDelay: Duration.minutes(1),
      supervisorMaxRestarts: 5,
      supervisorBackoffBaseDelay: Duration.seconds(10),
      supervisorBackoffMaxDelay: Duration.minutes(5),
      supervisorCooldown: Duration.minutes(30),
    }),
  },
) {}

const reportBasicMetrics = Effect.gen(function*() {
  const db = yield* DB
  const config = yield* HealthReporterConfig
  const now = yield* Clock.currentTimeMillis
  const cutoff = new Date(now - Duration.toMillis(config.reportInterval))

  const [deliveryRows, failureRows] = yield* Effect.all([
    Effect.tryPromise(() =>
      db
        .select({ count: count() })
        .from(pushRecord)
        .where(gte(pushRecord.sentAt, cutoff))
    ),
    Effect.tryPromise(() =>
      db
        .select({ count: count() })
        .from(failedPushRecord)
        .where(gte(failedPushRecord.attemptedAt, cutoff))
    ),
  ])

  const deliveries = deliveryRows[0]?.count ?? 0
  const failures = failureRows[0]?.count ?? 0

  if (deliveries === 0 && failures === 0) return

  const total = deliveries + failures
  const successRate = (deliveries / total) * 100

  yield* Effect.logInfo('Subscription delivery health', {
    [SpanAttributes.BATCH_DELIVERIES]: String(deliveries),
    [SpanAttributes.BATCH_FAILURES]: String(failures),
    success_rate_percent: successRate.toFixed(1),
    interval_minutes: String(Duration.toMinutes(config.reportInterval)),
  })

  const errorRate = (failures / total) * 100
  if (errorRate > 5) {
    yield* Effect.annotateCurrentSpan({ [SpanAttributes.ERROR_CATEGORY]: 'health' })
    yield* Effect.logWarning('Delivery error rate exceeds threshold', {
      error_rate_percent: errorRate.toFixed(1),
      threshold_percent: '5',
    })
  }
})

const reportExtendedMetrics = Effect.gen(function*() {
  const db = yield* DB
  const config = yield* HealthReporterConfig
  const now = yield* Clock.currentTimeMillis
  const cutoff = new Date(now - Duration.toMillis(config.extendedReportInterval))

  const [subscriptionRows, ruleRows, nonRetryableRows] = yield* Effect.all([
    Effect.tryPromise(() =>
      db
        .select({ count: count() })
        .from(pushSubscription)
        .where(gte(pushSubscription.createdAt, cutoff))
    ),
    Effect.tryPromise(() =>
      db
        .select({ count: count() })
        .from(subscriptionRule)
        .where(gte(subscriptionRule.createdAt, cutoff))
    ),
    Effect.tryPromise(() =>
      db
        .select({ count: count() })
        .from(failedPushRecord)
        .where(and(gte(failedPushRecord.attemptedAt, cutoff), eq(failedPushRecord.retryable, false)))
    ),
  ])

  const newSubscriptions = subscriptionRows[0]?.count ?? 0
  const newRules = ruleRows[0]?.count ?? 0
  const nonRetryableFailures = nonRetryableRows[0]?.count ?? 0

  if (newSubscriptions === 0 && newRules === 0 && nonRetryableFailures === 0) return

  yield* Effect.logInfo('Subscription system health', {
    new_subscriptions: String(newSubscriptions),
    new_rules: String(newRules),
    non_retryable_failures: String(nonRetryableFailures),
    interval_minutes: String(Duration.toMinutes(config.extendedReportInterval)),
  })

  if (nonRetryableFailures > 0) {
    yield* Effect.annotateCurrentSpan({ [SpanAttributes.ERROR_CATEGORY]: 'health' })
    yield* Effect.logWarning('Non-retryable delivery failures detected', {
      count: String(nonRetryableFailures),
    })
  }
})

const make = Effect.gen(function*() {
  const config = yield* HealthReporterConfig
  const reporter = yield* DefectReporter
  const reportCause = (cause: Cause.Cause<unknown>) => reporter.captureException(cause)

  const withRetry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.retry(
        pipe(
          Schedule.exponential(config.retryBaseDelay),
          Schedule.jittered,
          Schedule.upTo(config.retryMaxDelay),
          Schedule.compose(Schedule.recurs(5)),
        ),
      ),
      Effect.tapError((err) => Effect.logWarning('Health reporter query failed after retries', err)),
    )

  const withDefectHandling = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tapError(() =>
        Effect.gen(function*() {
          yield* Effect.annotateCurrentSpan({
            [SpanAttributes.ERROR_CATEGORY]: 'defect',
          })
          yield* Effect.logError('Health reporter defect')
        })
      ),
    )

  const healthReporterBackoff = Schedule.exponential(config.supervisorBackoffBaseDelay).pipe(
    Schedule.jittered,
    Schedule.upTo(config.supervisorBackoffMaxDelay),
  )

  yield* reportBasicMetrics.pipe(
    withRetry,
    withDefectHandling,
    Effect.withLogSpan('job.health_reporter.basic'),
    Effect.repeat(Schedule.spaced(config.reportInterval)),
    withSupervision({
      name: 'health-reporter-basic',
      maxRestarts: config.supervisorMaxRestarts,
      backoff: healthReporterBackoff,
      cooldown: config.supervisorCooldown,
      onRestart: reportCause,
      onExhausted: reportCause,
    }),
    Effect.fork,
  )

  yield* reportExtendedMetrics.pipe(
    withRetry,
    withDefectHandling,
    Effect.withLogSpan('job.health_reporter.extended'),
    Effect.repeat(Schedule.spaced(config.extendedReportInterval)),
    withSupervision({
      name: 'health-reporter-extended',
      maxRestarts: config.supervisorMaxRestarts,
      backoff: healthReporterBackoff,
      cooldown: config.supervisorCooldown,
      onRestart: reportCause,
      onExhausted: reportCause,
    }),
    Effect.fork,
  )

  yield* Effect.logInfo('Health reporter daemon started', {
    basic_interval_minutes: String(Duration.toMinutes(config.reportInterval)),
    extended_interval_minutes: String(Duration.toMinutes(config.extendedReportInterval)),
  })
})

export class HealthReporterDaemon extends Context.Tag('HealthReporterDaemon')<
  HealthReporterDaemon,
  void
>() {
  static Default = Layer.scopedDiscard(make)
  static DefaultWithoutDependencies = Layer.scopedDiscard(make)
}
