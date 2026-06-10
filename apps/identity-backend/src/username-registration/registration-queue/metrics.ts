import { Metric } from 'effect'

const withQueueTag = <Type, In, Out>(metric: Metric.Metric<Type, In, Out>) =>
  Metric.tagged(metric, 'daemon', 'registration-queue')

export const queueCycleTotal = withQueueTag(
  Metric.counter('app.queue.cycle.total', {
    description: 'registration queue cycle ticks started',
  }),
)

export const queueCycleFailures = withQueueTag(
  Metric.counter('app.queue.cycle.failures', {
    incremental: true,
    description: 'registration queue cycle tick failures by reason',
  }),
)

export const queueCycleDuration = withQueueTag(
  Metric.timerWithBoundaries(
    'app.queue.cycle.duration',
    [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    'Duration of registration queue tick in seconds',
  ),
)

export const queueDepth = Metric.gauge('app.queue.depth', {
  description: 'Current number of QUEUED entries',
})

export const queueEnqueueTotal = withQueueTag(
  Metric.counter('app.queue.enqueue.total', {
    description: 'registration queue enqueue attempts',
  }),
)

export const queueEnqueueFailures = withQueueTag(
  Metric.counter('app.queue.enqueue.failures', {
    incremental: true,
    description: 'registration queue enqueue failures by reason',
  }),
)

export const queueBalanceCheckTotal = withQueueTag(
  Metric.counter('app.queue.balance_check.total', {
    description: 'registration queue balance check cycles started',
  }),
)

export const queueBalanceCheckDuration = withQueueTag(
  Metric.timerWithBoundaries(
    'app.queue.balance_check.duration',
    [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    'Duration of registration queue balance check tick in seconds',
  ),
)
