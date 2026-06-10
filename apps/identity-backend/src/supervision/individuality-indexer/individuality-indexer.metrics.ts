import { Metric } from 'effect'

const withIndividualityIndexerTag = <Type, In, Out>(metric: Metric.Metric<Type, In, Out>) =>
  Metric.tagged(metric, 'daemon', 'individuality-indexer')

export const individualityIndexerTickDuration = withIndividualityIndexerTag(
  Metric.timerWithBoundaries(
    'app.indexer.tick.duration',
    [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    'Duration of individuality indexer tick in seconds',
  ),
)

export const individualityIndexerTickTotal = withIndividualityIndexerTag(
  Metric.counter('app.indexer.tick.total', {
    description: 'individuality indexer ticks started',
  }),
)

export const individualityIndexerTickFailuresCounter = withIndividualityIndexerTag(
  Metric.counter('app.indexer.tick.failures', {
    incremental: true,
    description: 'individuality indexer tick failures by reason',
  }),
)

export const individualityIndexerIndexedConsumerDecodeFailures = withIndividualityIndexerTag(
  Metric.counter('app.indexer.decode_failures', {
    incremental: true,
    description: 'Consumers storage decode failures indexed by failure reason',
  }),
)

export const individualityIndexerRpcChangesMissing = withIndividualityIndexerTag(
  Metric.counter('app.indexer.rpc.changes_missing', {
    incremental: true,
    description: 'Pages where state_queryStorageAt returned fewer changes than requested keys',
  }),
)
