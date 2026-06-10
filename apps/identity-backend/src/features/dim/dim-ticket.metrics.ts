import { Metric } from 'effect'

export const dimTicketRegistrationsCounter = Metric.counter(
  'app.dim.ticket.registration',
  { description: 'Total DIM ticket registration outcomes' },
)

export const dimTicketRegistrationLatencyHistogram = Metric.timerWithBoundaries(
  'app.dim.ticket.registration.duration',
  [1, 2.5, 5, 10, 15, 30, 45, 60, 120, 300],
  'Histogram of DIM ticket registration latency',
)
