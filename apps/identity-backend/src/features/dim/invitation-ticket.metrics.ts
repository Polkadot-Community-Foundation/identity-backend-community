import { Metric, MetricBoundaries } from 'effect'

export const invitationTicketDaemonTickDurationHistogram = Metric.timerWithBoundaries(
  'app.dim.invitation_ticket.daemon.tick.duration',
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  'Histogram of invitation ticket daemon poll cycle duration',
)

export const invitationTicketBatchSizeHistogram = Metric.histogram(
  'app.dim.invitation_ticket.refill.batch_size',
  MetricBoundaries.fromIterable([1, 2, 3, 5, 8, 10, 15, 20, 30, 50]),
  'Histogram of tickets registered per force_batch refill submission',
)

export const invitationTicketPoolSizeGauge = Metric.gauge(
  'app.dim.invitation_ticket.pool.size',
  { description: 'Current number of available invitation tickets in the pool' },
)
