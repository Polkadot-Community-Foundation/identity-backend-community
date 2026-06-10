import { AssetHubRPCProviderService } from '#root/infrastructure/adapters/blockchain/asset-hub-rpc-provider.service'
import { PeopleRPCProviderService } from '#root/infrastructure/adapters/blockchain/people-rpc-provider.service'
import { PeopleTypedAPI } from '#root/infrastructure/adapters/blockchain/people-typed-api.service'
import { oneForOne, Supervision } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect, Layer, MetricLabel, Option } from 'effect'
import { AccountBalanceWorker, FinalizedBlockMetricsWorker, PeopleAttestationAllowanceWorker } from './workers/mod'

export class ChainMetricsSupervisorRuntimeConfig extends Context.Reference<ChainMetricsSupervisorRuntimeConfig>()(
  'identity-backend-container/ChainMetricsSupervisorRuntimeConfig',
  {
    defaultValue: () => ({
      backoffMaxDelay: Duration.seconds(30),
    }),
  },
) {}

export class ChainMetricsSupervisorConfig
  extends Context.Tag('identity-backend-container/ChainMetricsSupervisorConfig')<ChainMetricsSupervisorConfig, {
    accountPublicKey: Uint8Array
  }>()
{}

export class ChainMetricsSupervisor extends Effect.Service<ChainMetricsSupervisor>()(
  'identity-backend-container/ChainMetricsSupervisor',
  {
    effect: Effect.gen(function*() {
      const supervisorCfg = yield* ChainMetricsSupervisorRuntimeConfig
      const { accountPublicKey } = yield* ChainMetricsSupervisorConfig
      const peopleRPC = yield* PeopleRPCProviderService
      const assetHubRPCOption = yield* Effect.serviceOption(AssetHubRPCProviderService)

      const peopleWorkers = [
        FinalizedBlockMetricsWorker.make({
          client: peopleRPC,
          metricLabels: [MetricLabel.make('network', 'people')],
        }),
        AccountBalanceWorker.make({
          name: 'account-balance-attester',
          accountPublicKey,
          metricLabels: [
            MetricLabel.make('network', 'people'),
            MetricLabel.make('tracked_role', 'attester'),
          ],
        }),
        PeopleAttestationAllowanceWorker.make({
          name: 'people-attestation-allowance',
          accountPublicKey,
          metricLabels: [
            MetricLabel.make('network', 'people'),
            MetricLabel.make('tracked_role', 'attester'),
          ],
        }),
      ]

      const assetHubWorkers = Option.match(assetHubRPCOption, {
        onNone: () => [] as const,
        onSome: (assetHubRPC) => [
          FinalizedBlockMetricsWorker.make({
            client: assetHubRPC,
            metricLabels: [MetricLabel.make('network', 'asset-hub')],
          }),
          AccountBalanceWorker.make({
            name: 'account-balance-attester',
            accountPublicKey,
            metricLabels: [
              MetricLabel.make('network', 'asset-hub'),
              MetricLabel.make('tracked_role', 'attester'),
            ],
          }),
        ],
      })

      const children = yield* Effect.all([
        ...peopleWorkers,
        ...assetHubWorkers,
      ])

      return oneForOne({
        name: 'chain-metrics',
        lock: { mode: 'none' },
        children,
        supervision: Supervision.worker(supervisorCfg.backoffMaxDelay),
      })
    }),
    dependencies: [
      PeopleTypedAPI.Default,
      Layer.effect(
        ChainMetricsSupervisorConfig,
        Effect.gen(function*() {
          const { ATTESTER_PUBLIC_KEY } = yield* Effect.promise(() => import('#root/config.js'))
          return ChainMetricsSupervisorConfig.of({ accountPublicKey: yield* ATTESTER_PUBLIC_KEY })
        }),
      ),
    ],
  },
) {}
