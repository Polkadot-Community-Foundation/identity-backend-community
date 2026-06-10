import type { paseo_asset_hub_next, previewnet_asset_hub } from '@identity-backend/descriptors'
import { Effect } from 'effect'
import type { SharedUnionFieldsDeep } from 'type-fest'
import { AssetHubRPCProviderService } from './asset-hub-rpc-provider.service'

type _Descriptors = SharedUnionFieldsDeep<typeof paseo_asset_hub_next | typeof previewnet_asset_hub>

export namespace AssetHubTypedAPI {
  export type Descriptors = _Descriptors
}

export class AssetHubTypedAPI extends Effect.Service<AssetHubTypedAPI>()(
  '@app/AssetHubTypedAPI',
  {
    effect: Effect.gen(function*() {
      const { previewnet_asset_hub } = yield* Effect.promise(() => import('@identity-backend/descriptors'))
      const client = yield* AssetHubRPCProviderService

      return client.getTypedApi<_Descriptors>(previewnet_asset_hub)
    }),
    dependencies: [AssetHubRPCProviderService.Default],
  },
) {}
