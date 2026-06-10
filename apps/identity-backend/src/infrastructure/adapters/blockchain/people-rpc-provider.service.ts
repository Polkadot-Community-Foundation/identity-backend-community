import { PolkadotClient } from '@identity-backend/json-rpc'
import { Config, Context, Duration, Effect, Layer } from 'effect'

export class PeopleRPCProviderServiceConfig extends Context.Tag(
  'identity-backend-container/PeopleRPCProviderServiceConfig',
)<PeopleRPCProviderServiceConfig, {
  rpcEndpoints: string[]
  heartbeatTimeout: Duration.Duration
  network: string
}>() {}

export class PeopleRPCProviderService
  extends Effect.Service<PeopleRPCProviderService>()('@identity-backend-container/PeopleRPCProviderService', {
    scoped: Effect.gen(function*() {
      const { rpcEndpoints, heartbeatTimeout, network } = yield* PeopleRPCProviderServiceConfig
      return yield* PolkadotClient.make({
        endpoints: rpcEndpoints,
        heartbeatTimeout: Duration.toMillis(heartbeatTimeout),
        network,
        chain: 'people',
      })
    }),
    dependencies: [
      Layer.effect(
        PeopleRPCProviderServiceConfig,
        Effect.gen(function*() {
          const config = yield* Effect.promise(() => import('#root/config.js'))

          return PeopleRPCProviderServiceConfig.of({
            ...(yield* Config.all({
              rpcEndpoints: config.PEOPLE_RPC_ENDPOINTS,
              heartbeatTimeout: config.WEBSOCKET_HEARTBEAT_TIMEOUT,
              network: config.PEOPLE_NETWORK,
            })),
          })
        }),
      ),
    ],
  })
{}
