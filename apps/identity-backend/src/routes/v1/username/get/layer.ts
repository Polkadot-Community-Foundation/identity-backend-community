import { Effect, Layer } from 'effect'
import { GetUsernamesV1RouteConfig } from './types.js'

const PREFIX = 'get_usernames_v1_route'

export const layerGetUsernamesV1Routes = Layer.effect(
  GetUsernamesV1RouteConfig,
  Effect.gen(function*() {
    const { PEOPLE_NETWORK } = yield* Effect.promise(() => import('#root/config.js'))

    const network = yield* PEOPLE_NETWORK

    const getNetwork = Effect.fn(`${PREFIX}.get_network`)(function*() {
      yield* Effect.annotateCurrentSpan({ network })

      return network
    })

    return {
      getNetwork,
    } satisfies GetUsernamesV1RouteConfig['Type']
  }),
)
