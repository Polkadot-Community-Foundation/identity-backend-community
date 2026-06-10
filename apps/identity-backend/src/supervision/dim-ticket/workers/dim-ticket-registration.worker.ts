import { DimTicketDaemonShell } from '#root/features/dim/dim-ticket-daemon.shell.js'
import { dimTicketRegistrationLatencyHistogram } from '#root/features/dim/dim-ticket.metrics.js'
import { Daemon } from '@identity-backend/effect-daemon-spec'
import { Clock, Context, Duration, Effect, Schedule } from 'effect'

/** Tunables for the dim-ticket registration worker. */
export interface DimTicketRegistrationRuntimeConfig {
  readonly pollInterval: Duration.Duration
  readonly tickTimeout: Duration.Duration
  readonly batchSize: number
  readonly maxRetries: number
  readonly innerRetryBaseDelay: Duration.Duration
  readonly innerRetryMaxDelay: Duration.Duration
  readonly innerRetryMaxAttempts: number
}

export class DimTicketRegistrationConfig extends Context.Reference<DimTicketRegistrationConfig>()(
  'DimTicketRegistrationConfig',
  {
    defaultValue: (): DimTicketRegistrationRuntimeConfig => ({
      pollInterval: Duration.seconds(6),
      tickTimeout: Duration.seconds(60),
      batchSize: 10,
      maxRetries: 5,
      innerRetryBaseDelay: Duration.seconds(1),
      innerRetryMaxDelay: Duration.minutes(1),
      innerRetryMaxAttempts: 5,
    }),
  },
) {}

const innerRetrySchedule = (
  baseDelay: Duration.Duration,
  maxDelay: Duration.Duration,
  maxAttempts: number,
) =>
  Schedule.exponential(baseDelay).pipe(
    Schedule.jittered,
    Schedule.upTo(maxDelay),
    Schedule.compose(Schedule.recurs(maxAttempts)),
  )

export const make = Effect.gen(function*() {
  const config = yield* DimTicketRegistrationConfig
  const shell = yield* DimTicketDaemonShell

  const work = Effect.gen(function*() {
    const now = yield* Clock.currentTimeMillis
    const tickets = yield* shell.fetchPendingTickets(now, config.batchSize)
    const fetchedCount = tickets.length
    yield* shell.processTickets(tickets, now, config.maxRetries)
    if (fetchedCount > 0) {
      yield* Effect.logInfo('Fetched pending tickets', { 'dim.ticket.fetched': fetchedCount })
    }
  }).pipe(
    Effect.withLogSpan('dim_ticket.poll_cycle'),
  )

  return Daemon.poll({
    name: 'dim-ticket-registration',
    interval: config.pollInterval,
    tick: {
      spanName: 'jobs.dim_ticket.register',
      tickTimeout: config.tickTimeout,
    },
    tickHooks: {
      trackDuration: dimTicketRegistrationLatencyHistogram,
      innerRetry: innerRetrySchedule(
        config.innerRetryBaseDelay,
        config.innerRetryMaxDelay,
        config.innerRetryMaxAttempts,
      ),
    },
    lock: { mode: 'none' },
    work: work.pipe(
      Effect.tapError((error) =>
        Effect.logError('Dim ticket tick failed', {
          'error.type': error._tag,
          'error.category': 'category' in error ? String(error.category) : 'unknown',
          'error.retryable': 'retryable' in error ? Boolean(error.retryable) : false,
        })
      ),
    ),
  })
})
