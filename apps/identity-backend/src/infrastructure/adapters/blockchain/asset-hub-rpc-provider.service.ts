import { PolkadotClient } from '@identity-backend/json-rpc'
import { Config, Context, Duration, Effect, Layer } from 'effect'

export class AssetHubRPCProviderServiceConfig extends Context.Tag(
  'identity-backend-container/AssetHubRPCProviderServiceConfig',
)<AssetHubRPCProviderServiceConfig, {
  rpcEndpoints: string[]
  heartbeatTimeout: Duration.Duration
  network: string
}>() {}

export class AssetHubRPCProviderService
  extends Effect.Service<AssetHubRPCProviderService>()('@identity-backend-container/AssetHubRPCProviderService', {
    scoped: Effect.gen(function*() {
      const { rpcEndpoints, heartbeatTimeout, network } = yield* AssetHubRPCProviderServiceConfig
      return yield* PolkadotClient.make({
        endpoints: rpcEndpoints,
        heartbeatTimeout: Duration.toMillis(heartbeatTimeout),
        network,
        chain: 'asset-hub',
      })
    }),
    dependencies: [
      Layer.effect(
        AssetHubRPCProviderServiceConfig,
        Effect.gen(function*() {
          const config = yield* Effect.promise(() => import('#root/config.js'))

          return AssetHubRPCProviderServiceConfig.of({
            ...(yield* Config.all({
              rpcEndpoints: config.ASSET_HUB_RPC_ENDPOINTS,
              heartbeatTimeout: config.WEBSOCKET_HEARTBEAT_TIMEOUT,
              network: config.PEOPLE_NETWORK,
            })),
          })
        }),
      ),
    ],
  })
{}
