import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { oneForOne, Supervision } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect, Layer } from 'effect'
import { DimTicketRegistrationConfig } from './workers/dim-ticket-registration.worker.js'
import { DimTicketRegistrationWorker } from './workers/mod.js'

export interface DimTicketSupervisorRuntimeConfig {
  readonly backoffMaxDelay: Duration.Duration
}

export class DimTicketSupervisorConfig extends Context.Reference<DimTicketSupervisorConfig>()(
  'DimTicketSupervisorConfig',
  {
    defaultValue: (): DimTicketSupervisorRuntimeConfig => ({
      backoffMaxDelay: Duration.seconds(30),
    }),
  },
) {}

export class DimTicketSupervisor extends Effect.Service<DimTicketSupervisor>()(
  'identity-backend-container/DimTicketSupervisor',
  {
    effect: Effect.gen(function*() {
      const supervisorCfg = yield* DimTicketSupervisorConfig
      const defectReporter = yield* DefectReporter
      const child = yield* DimTicketRegistrationWorker.make

      return oneForOne({
        name: 'dim-ticket',
        lock: { mode: 'none' },
        children: [child],
        supervision: Supervision.worker(supervisorCfg.backoffMaxDelay),
        reporter: {
          onRestart: (cause) => defectReporter.captureException(cause),
          onExhausted: (cause) => defectReporter.captureException(cause),
        },
      })
    }),
    dependencies: [
      Layer.succeed(
        DimTicketRegistrationConfig,
        DimTicketRegistrationConfig.of({
          pollInterval: Duration.seconds(6),
          tickTimeout: Duration.seconds(60),
          batchSize: 10,
          maxRetries: 5,
          innerRetryBaseDelay: Duration.seconds(1),
          innerRetryMaxDelay: Duration.minutes(1),
          innerRetryMaxAttempts: 5,
        }),
      ),
    ],
  },
) {}
