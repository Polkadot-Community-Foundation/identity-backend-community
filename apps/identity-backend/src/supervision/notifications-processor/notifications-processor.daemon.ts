import { SubscriptionDaemonShell } from '#root/features/subscriptions/pipeline/processor.shell.js'
import { oneForOne, Supervision } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect } from 'effect'
import { StatementProcessorWorker } from './workers/mod.js'

export class NotificationsProcessorSupervisorRuntimeConfig
  extends Context.Reference<NotificationsProcessorSupervisorRuntimeConfig>()(
    'NotificationsProcessorSupervisorConfig',
    {
      defaultValue: () => ({
        backoffMaxDelay: Duration.minutes(5),
      }),
    },
  )
{}

export class NotificationsProcessorSupervisor extends Effect.Service<NotificationsProcessorSupervisor>()(
  'identity-backend-container/NotificationsProcessorSupervisor',
  {
    effect: Effect.gen(function*() {
      const supervisorCfg = yield* NotificationsProcessorSupervisorRuntimeConfig
      const children = yield* Effect.all(
        [StatementProcessorWorker.make()],
      )

      return oneForOne({
        name: 'notifications-processor',
        lock: { mode: 'none' },
        children,
        supervision: Supervision.worker(supervisorCfg.backoffMaxDelay),
      })
    }),
    dependencies: [
      SubscriptionDaemonShell.Default,
    ],
  },
) {}
