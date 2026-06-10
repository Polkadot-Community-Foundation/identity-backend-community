import { Daemon } from '@identity-backend/effect-daemon-spec'
import { PolkadotClient } from '@identity-backend/json-rpc'
import { Duration, Effect, Metric, Stream } from 'effect'
import type * as MetricLabelT from 'effect/MetricLabel'
import type { BlockInfo } from 'polkadot-api'

const finalizedBlockBaseGauge = Metric.gauge('blockchain.finalized_block', {
  description: 'Latest finalized block number for a tracked Substrate client',
})

export interface FinalizedBlockMetricsWorkSpec {
  readonly client: PolkadotClient.PolkadotClientWithProvider
  readonly metricLabels?: ReadonlyArray<MetricLabelT.MetricLabel>
}

const finalizedBlockStream = (client: PolkadotClient.PolkadotClientWithProvider) =>
  Stream.asyncPush<BlockInfo>(
    (emit) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          client.finalizedBlock$.subscribe({
            next: (blockInfo) => {
              void emit.single(blockInfo)
            },
          })
        ),
        (sub) => Effect.sync(() => sub.unsubscribe()),
      ),
    { bufferSize: 'unbounded' },
  )

export const make = (spec: FinalizedBlockMetricsWorkSpec) => {
  const { client, metricLabels = [] } = spec
  const gauge = Metric.taggedWithLabels(finalizedBlockBaseGauge, metricLabels)

  return Effect.succeed(
    Daemon.stream({
      name: 'finalized-block-metrics',
      stream: Stream.tap(finalizedBlockStream(client), (blockInfo) => Metric.set(gauge, blockInfo.number)),
      tick: { tickTimeout: Duration.seconds(90) },
      lock: { mode: 'none' },
    }),
  )
}
