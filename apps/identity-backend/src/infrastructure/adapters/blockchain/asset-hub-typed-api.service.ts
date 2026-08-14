import { ASSET_HUB_CHAIN_DESCRIPTOR } from '#root/config.js'
import type { paseo_asset_hub, paseo_asset_hub_next, previewnet_asset_hub } from '@identity-backend/descriptors'
import { Effect } from 'effect'
import type { SharedUnionFieldsDeep } from 'type-fest'
import { AssetHubRPCProviderService } from './asset-hub-rpc-provider.service'

type _Descriptors = SharedUnionFieldsDeep<
  typeof paseo_asset_hub | typeof paseo_asset_hub_next | typeof previewnet_asset_hub
>

export namespace AssetHubTypedAPI {
  export type Descriptors = _Descriptors
}

export class AssetHubTypedAPI extends Effect.Service<AssetHubTypedAPI>()(
  '@app/AssetHubTypedAPI',
  {
    effect: Effect.gen(function*() {
      const descriptorName = yield* ASSET_HUB_CHAIN_DESCRIPTOR
      const descriptors = yield* Effect.promise(() => import('@identity-backend/descriptors'))
      const client = yield* AssetHubRPCProviderService

      return client.getTypedApi<_Descriptors>(descriptors[descriptorName])
    }),
    dependencies: [AssetHubRPCProviderService.Default],
  },
) {}
