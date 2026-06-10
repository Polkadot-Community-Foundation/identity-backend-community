import { Context, Effect, Layer } from 'effect'

import { type Network } from './entry.schema.js'
import { RegistrationQueueNetworkConfig } from './network.config.js'
import { QueuePriorityConfig } from './priority-group.config.js'

export class RegistrationQueueStatusConfig extends Context.Tag('RegistrationQueueStatusConfig')<
  RegistrationQueueStatusConfig,
  { readonly network: Network; readonly slotCount: number }
>() {
  static readonly Default = Layer.provide(
    Layer.effect(
      RegistrationQueueStatusConfig,
      Effect.gen(function*() {
        const { network } = yield* RegistrationQueueNetworkConfig
        const { slots } = yield* QueuePriorityConfig
        return { network, slotCount: slots.length }
      }),
    ),
    RegistrationQueueNetworkConfig.Default,
  )
}
