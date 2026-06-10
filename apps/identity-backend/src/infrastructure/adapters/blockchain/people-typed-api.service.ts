import { PEOPLE_CHAIN_DESCRIPTOR } from '#root/config.js'
import type { paseo_people, paseo_people_next, previewnet_people } from '@identity-backend/descriptors'
import { Effect } from 'effect'
import type { SharedUnionFieldsDeep } from 'type-fest'
import { PeopleRPCProviderService } from './people-rpc-provider.service'

type _Descriptors = SharedUnionFieldsDeep<typeof previewnet_people | typeof paseo_people | typeof paseo_people_next>

export namespace PeopleTypedAPI {
  export type Descriptors = _Descriptors
}

export class PeopleTypedAPI extends Effect.Service<PeopleTypedAPI>()(
  '@identity-backend-container/PolkadotTestTypedAPI',
  {
    effect: Effect.gen(function*() {
      const descriptorName = yield* PEOPLE_CHAIN_DESCRIPTOR
      const descriptors = yield* Effect.promise(() => import('@identity-backend/descriptors'))
      const client = yield* PeopleRPCProviderService
      const descriptor = descriptors[descriptorName]

      return client.getTypedApi<_Descriptors>(descriptor)
    }),
    dependencies: [
      PeopleRPCProviderService.Default,
    ],
  },
) {}
