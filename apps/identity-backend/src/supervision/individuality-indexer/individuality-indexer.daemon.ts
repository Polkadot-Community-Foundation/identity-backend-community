import { type Child, oneForOne, Supervision } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect, Layer } from 'effect'

export interface IndividualityIndexerSupervisorRuntimeConfig {
  readonly backoffMaxDelay: Duration.Duration
}

export class IndividualityIndexerSupervisorConfig extends Context.Reference<IndividualityIndexerSupervisorConfig>()(
  'IndividualityIndexerSupervisorConfig',
  {
    defaultValue: (): IndividualityIndexerSupervisorRuntimeConfig => ({
      backoffMaxDelay: Duration.seconds(30),
    }),
  },
) {}

export type IndividualityIndexerSupervisorR = never

export type IndividualityIndexerSupervisorValue = ReturnType<
  typeof oneForOne<never, IndividualityIndexerSupervisorR>
>

export class IndividualityIndexerSupervisor extends Context.Tag('IndividualityIndexerSupervisor')<
  IndividualityIndexerSupervisor,
  IndividualityIndexerSupervisorValue
>() {}

export interface LayerIndividualityIndexerSupervisorInput<ChildrenR = never> {
  readonly children: Effect.Effect<
    ReadonlyArray<Child<never, IndividualityIndexerSupervisorR>>,
    never,
    ChildrenR
  >
}

export const layerIndividualityIndexerSupervisor = <ChildrenR>(
  input: LayerIndividualityIndexerSupervisorInput<ChildrenR>,
) =>
  Layer.effect(
    IndividualityIndexerSupervisor,
    Effect.gen(function*() {
      const supervisorCfg = yield* IndividualityIndexerSupervisorConfig
      const children = yield* input.children

      return oneForOne({
        name: 'individuality-indexer',
        lock: { mode: 'none' },
        children,
        supervision: Supervision.worker(supervisorCfg.backoffMaxDelay),
      })
    }),
  )
