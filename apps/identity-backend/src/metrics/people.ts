import { Metric } from 'effect'

export const peopleRegisterUsernamesOperationsTotalCounter = Metric.counter(
  'app.people.username.registrations',
  {
    description: 'Total number of People username registration operations attempted',
  },
)

export const peopleRegisterUsernamesOperationsFailureCounter = Metric.counter(
  'app.people.username.registration_failures',
  {
    description: 'Number of failed People username registration operations',
  },
)

export const peopleRegisterUsernamesLatencyHistogram = Metric.timerWithBoundaries(
  'app.people.username.registration.duration',
  [1, 2.5, 5, 10, 15, 30, 45, 60, 75, 90],
  'Histogram tracking the duration of People chain username registration operations',
)
