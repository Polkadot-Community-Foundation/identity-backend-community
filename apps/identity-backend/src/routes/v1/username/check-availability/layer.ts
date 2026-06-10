import { IndividualityUsernameService } from '#root/features/individuality/services/username-availability.service.js'
import { Effect, Layer } from 'effect'
import { CheckAvailabilityRouteConfig } from './routes.js'

export const layerCheckAvailabilityRoutes = Layer.effect(
  CheckAvailabilityRouteConfig,
  Effect.gen(function*() {
    const { MAXIMUM_USERNAME_ALLOCATION } = yield* Effect.promise(() => import('#root/constants.js'))
    const usernameService = yield* IndividualityUsernameService

    return {
      checkUsernamesAvailability: usernameService.checkAvailability,
      getMaximumUsernameAllocation: () => MAXIMUM_USERNAME_ALLOCATION,
    } satisfies CheckAvailabilityRouteConfig['Type']
  }),
)
