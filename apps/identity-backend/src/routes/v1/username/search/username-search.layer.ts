import { SearchUsernamesV1RouteConfig } from '#root/routes/v1/username/search/username-search.config.js'
import { Effect, Layer } from 'effect'

export const layerSearchUsernamesV1Routes = Layer.effect(
  SearchUsernamesV1RouteConfig,
  Effect.gen(function*() {
    const { PEOPLE_NETWORK } = yield* Effect.promise(() => import('#root/config.js'))

    return {
      getNetwork: () => PEOPLE_NETWORK.pipe(Effect.orDie),
    } satisfies SearchUsernamesV1RouteConfig['Type'] as SearchUsernamesV1RouteConfig['Type']
  }),
)
