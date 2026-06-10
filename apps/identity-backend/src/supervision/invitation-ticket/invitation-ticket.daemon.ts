import { oneForOne, Supervision, type Supervisor } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect, Layer } from 'effect'

import { InvitationTicketWorker } from './workers/mod.js'

export class InvitationTicketSupervisorConfig extends Context.Reference<InvitationTicketSupervisorConfig>()(
  'InvitationTicketSupervisorConfig',
  {
    defaultValue: () => ({
      backoffMaxDelay: Duration.minutes(5),
    }),
  },
) {}

const make = Effect.gen(function*() {
  const { backoffMaxDelay } = yield* InvitationTicketSupervisorConfig
  const children = yield* Effect.all([InvitationTicketWorker.make()])

  return oneForOne({
    name: 'invitation-ticket',
    lock: { mode: 'none' },
    children,
    supervision: Supervision.worker(backoffMaxDelay),
  })
})

export class InvitationTicketSupervisor extends Context.Tag('InvitationTicketSupervisor')<
  InvitationTicketSupervisor,
  Supervisor<unknown, never>
>() {
  static readonly Default = Layer.scoped(InvitationTicketSupervisor, make)
}
