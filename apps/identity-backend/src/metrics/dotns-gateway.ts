import { Metric } from 'effect'

export const dotnsGatewayReserveOperationsTotalCounter = Metric.counter(
  'app.dotns_gateway.reservations',
  {
    description: 'Total number of dotNS gateway reservation operations attempted',
  },
)

export const dotnsGatewayReserveOperationsFailureCounter = Metric.counter(
  'app.dotns_gateway.reservation_failures',
  {
    description: 'Number of failed dotNS gateway reservation operations',
  },
)

export const dotnsGatewayReserveLatencyHistogram = Metric.timerWithBoundaries(
  'app.dotns_gateway.reservation.duration',
  [1, 2.5, 5, 10, 15, 30, 45, 60, 75, 90],
  'Histogram tracking the duration of dotNS gateway reservation operations',
)
