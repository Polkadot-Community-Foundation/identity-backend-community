import { LiteUsernameRegistrationSupervisor } from '#root/supervision/lite-username-registration/mod.js'
import { RegistrationQueueSupervisor } from '#root/supervision/registration-queue/mod.js'
import { oneForOne, run, Supervision } from '@identity-backend/effect-daemon-spec'
import { Array, Context, Duration, Effect, Layer, Schedule } from 'effect'
import { ChainMetricsSupervisor } from '../chain-metrics/chain-metrics.daemon.js'
import { DimTicketSupervisor } from '../dim-ticket/mod.js'
import { IndividualityIndexerSupervisor } from '../individuality-indexer/mod.js'
import { InvitationTicketSupervisor } from '../invitation-ticket/invitation-ticket.daemon.js'
import { NotificationsProcessorSupervisor } from '../notifications-processor/mod.js'

export interface DaemonLeaderSupervisorRuntimeConfig {
  readonly lockRetryBaseDelay: Duration.Duration
  readonly lockRetryMaxDelay: Duration.Duration
  readonly supervisionBackoffCap: Duration.Duration
}

export class DaemonLeaderSupervisorConfig extends Context.Reference<DaemonLeaderSupervisorConfig>()(
  'DaemonLeaderSupervisorConfig',
  {
    defaultValue: (): DaemonLeaderSupervisorRuntimeConfig => ({
      lockRetryBaseDelay: Duration.millis(500),
      lockRetryMaxDelay: Duration.seconds(5),
      supervisionBackoffCap: Duration.seconds(30),
    }),
  },
) {}

export const layerDaemonLeaderSupervisor = Layer.scopedDiscard(
  Effect.gen(function*() {
    const cfg = yield* DaemonLeaderSupervisorConfig

    const children = yield* Effect.all(
      [
        Effect.serviceOption(ChainMetricsSupervisor),
        Effect.serviceOption(DimTicketSupervisor),
        Effect.serviceOption(IndividualityIndexerSupervisor),
        Effect.serviceOption(InvitationTicketSupervisor),
        Effect.serviceOption(NotificationsProcessorSupervisor),
        Effect.serviceOption(LiteUsernameRegistrationSupervisor),
        Effect.serviceOption(RegistrationQueueSupervisor),
      ] as const,
    ).pipe(Effect.map(Array.getSomes))

    yield* run.supervisor(
      oneForOne({
        name: 'daemon-leader',
        lock: {
          key: 'identity-backend:daemon-leader',
          mode: 'required',
          acquireRetryBackoff: Schedule.exponential(cfg.lockRetryBaseDelay).pipe(
            Schedule.upTo(cfg.lockRetryMaxDelay),
          ),
        },
        children,
        supervision: Supervision.leader(cfg.supervisionBackoffCap),
      }),
    )
  }),
)
