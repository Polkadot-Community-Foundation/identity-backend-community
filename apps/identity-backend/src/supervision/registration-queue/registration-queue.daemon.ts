import { oneForOne, Supervision, type Supervisor } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect, Layer } from 'effect'
import { UnknownException } from 'effect/Cause'

import { RegistrationQueueNetworkConfig } from '#root/username-registration/registration-queue/network.config.js'
import { makeBalanceCheckWorker, makeRegistrationQueueWorker, RegistrationQueueConfig } from './workers/mod.js'

export interface RegistrationQueueSupervisorRuntimeConfig {
  readonly backoffMaxDelay: Duration.Duration
}

export class RegistrationQueueSupervisorConfig extends Context.Reference<RegistrationQueueSupervisorConfig>()(
  'RegistrationQueueSupervisorConfig',
  {
    defaultValue: (): RegistrationQueueSupervisorRuntimeConfig => ({
      backoffMaxDelay: Duration.seconds(30),
    }),
  },
) {}

const make = Effect.gen(function*() {
  const supervisorCfg = yield* RegistrationQueueSupervisorConfig

  const children = yield* Effect.all([
    makeRegistrationQueueWorker,
    makeBalanceCheckWorker,
  ])

  return oneForOne({
    name: 'registration-queue',
    lock: {
      mode: 'none',
    },
    children,
    supervision: Supervision.worker(supervisorCfg.backoffMaxDelay),
  })
})

export class RegistrationQueueSupervisor extends Context.Tag('RegistrationQueueSupervisor')<
  RegistrationQueueSupervisor,
  Supervisor<UnknownException, never>
>() {
  static readonly DefaultWithDependencies = Layer.scoped(RegistrationQueueSupervisor, make)

  static readonly Default = Layer.suspend(() => RegistrationQueueSupervisor.DefaultWithDependencies).pipe(
    Layer.provide(Layer.mergeAll(
      Layer.effect(
        RegistrationQueueConfig,
        Effect.gen(function*() {
          const { network } = yield* RegistrationQueueNetworkConfig
          return RegistrationQueueConfig.of({ network })
        }),
      ),
    )),
  )
}
