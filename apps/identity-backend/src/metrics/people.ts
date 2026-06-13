import { Metric, MetricBoundaries } from 'effect'

export const peopleUsernameE2eDurationHistogram = Metric.histogram(
  'app.people.username.e2e.duration',
  MetricBoundaries.fromIterable([15, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100]),
  'User-visible username registration latency in seconds (updatedAt - createdAt) when a row flips to ASSIGNED',
)

export const peopleUsernameQueueAgeHistogram = Metric.histogram(
  'app.people.username.queue_age',
  MetricBoundaries.fromIterable([0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]),
  'Seconds a reserved username row waited in RESERVED before daemon pickup (now - createdAt at pickup)',
)

export const peopleUsernameStageDurationHistogram = Metric.histogram(
  'app.people.username.stage.duration',
  MetricBoundaries.fromIterable([0.5, 1, 2, 5, 10, 15, 20, 30, 40, 50, 60, 90]),
  'Per-stage on-chain latency in seconds from submission, tagged stage=signed|broadcasted|best_blocks|finalized',
)

export const peopleUsernameChainFinalizationHistogram = Metric.histogram(
  'app.people.username.chain.finalization',
  MetricBoundaries.fromIterable([6, 12, 18, 24, 30, 36, 42, 48, 60]),
  'Chain-only best-block to finalized latency in seconds',
)

export const peopleUsernameIntakeDurationHistogram = Metric.histogram(
  'app.people.username.intake.duration',
  MetricBoundaries.fromIterable([0.05, 0.1, 0.25, 0.5, 1, 2, 5]),
  'Seconds from user signing (signedAt) to API intake (createdAt)',
)

export const peopleUsernameRegistrationsIntakeCounter = Metric.counter(
  'app.people.username.registrations.intake',
  {
    description: 'Per-item username intake outcomes, tagged disposition=inserted|already_taken|persistence_error',
  },
)

export const peopleUsernameRegistrationsCompletedCounter = Metric.counter(
  'app.people.username.registrations.completed',
  {
    description:
      'Per-item completed username registrations, tagged completion=item_completed|already_registered_on_chain',
  },
)

export const peopleUsernameRegistrationsFailedCounter = Metric.counter(
  'app.people.username.registrations.failed',
  {
    description:
      'Per-item failed username registrations, tagged failure=terminal|retryable|submit_error|finalization_timeout|tx_not_included. A row is only ever terminal (FAILED) on a terminal on-chain error; all other failures stay RESERVED and retry on the next poll',
  },
)

export const peopleUsernameDaemonHeartbeatGauge = Metric.gauge(
  'app.people.username.daemon.heartbeat',
  { description: '1 when the registration tick completed within the last 2x tickTimeout, else 0' },
)

export const peopleUsernameDaemonLeaderGauge = Metric.gauge(
  'app.people.username.daemon.leader',
  { description: '1 when this process holds the daemon-leader lock, else 0' },
)

export const peopleUsernameDaemonTickDurationHistogram = Metric.timerWithBoundaries(
  'app.people.username.daemon.tick.duration',
  [5_000, 15_000, 25_000, 35_000, 45_000, 50_000, 55_000, 60_000, 70_000, 80_000, 90_000, 100_000],
  'Daemon tick duration in milliseconds (timerWithBoundaries records Duration.toMillis), calibrated to the observed tick distribution and the 100s SLA',
)
