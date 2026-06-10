import { Metric, MetricBoundaries } from 'effect'

export const httpRequestsTotalCounter = Metric.counter(
  'http.server.request.count',
  {
    description: 'Total number of HTTP requests processed',
  },
)

// timerWithBoundaries applies Duration.toMillis internally, making second-scale boundaries useless.
// Use histogram + MetricBoundaries to pass raw seconds directly.
export const httpRequestDurationHistogram = Metric.histogram(
  'http.server.request.duration',
  MetricBoundaries.fromIterable([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60]),
  'Histogram of HTTP request duration',
)
