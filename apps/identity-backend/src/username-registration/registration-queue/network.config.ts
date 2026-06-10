import { Context, Effect, Layer } from 'effect'

import { PEOPLE_NETWORK } from '#root/config.js'

import { type Network } from './entry.schema.js'

export class RegistrationQueueNetworkConfig extends Context.Tag('RegistrationQueueNetworkConfig')<
  RegistrationQueueNetworkConfig,
  { readonly network: Network }
>() {
  static readonly Default: Layer.Layer<RegistrationQueueNetworkConfig> = Layer.effect(
    RegistrationQueueNetworkConfig,
    Effect.gen(function*() {
      const network = yield* PEOPLE_NETWORK
      return { network }
    }).pipe(Effect.orDie),
  )
}
