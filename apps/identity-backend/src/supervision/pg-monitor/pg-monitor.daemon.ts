import { oneForOne, Supervision } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect } from 'effect'

import { makePgMonitorCapacityWorker } from './workers/pg-monitor-capacity.worker.js'
import { makePgMonitorIoWorker } from './workers/pg-monitor-io.worker.js'
import { makePgMonitorLivenessWorker } from './workers/pg-monitor-liveness.worker.js'
import { makePgMonitorSessionsWorker } from './workers/pg-monitor-sessions.worker.js'

export interface PgMonitorSupervisorRuntimeConfig {
  readonly backoffMaxDelay: Duration.Duration
}

export class PgMonitorSupervisorConfig extends Context.Reference<PgMonitorSupervisorConfig>()(
  'identity-backend-container/PgMonitorSupervisorConfig',
  {
    defaultValue: (): PgMonitorSupervisorRuntimeConfig => ({
      backoffMaxDelay: Duration.seconds(30),
    }),
  },
) {}

export class PgMonitorSupervisor extends Effect.Service<PgMonitorSupervisor>()(
  'identity-backend-container/PgMonitorSupervisor',
  {
    effect: Effect.gen(function*() {
      const supervisorCfg = yield* PgMonitorSupervisorConfig

      const children = yield* Effect.all([
        makePgMonitorLivenessWorker,
        makePgMonitorIoWorker,
        makePgMonitorSessionsWorker,
        makePgMonitorCapacityWorker,
      ])

      return oneForOne({
        name: 'pg-monitor',
        lock: { mode: 'none' },
        children,
        supervision: Supervision.worker(supervisorCfg.backoffMaxDelay),
      })
    }),
  },
) {}
