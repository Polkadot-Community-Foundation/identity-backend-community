import { Context, Effect } from 'effect'

export class SearchUsernamesV1RouteConfig extends Context.Tag(
  'identity-backend-container/routes/v1/username/search/config/SearchUsernamesV1RouteConfig',
)<
  SearchUsernamesV1RouteConfig,
  {
    getNetwork: () => Effect.Effect<'westend2' | 'paseo' | 'polkadot'>
  }
>() {}
