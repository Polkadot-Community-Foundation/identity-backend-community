import { TicketPoolShell } from '#root/features/dim/invitation-ticket-pool.shell.js'
import { type Network } from '#root/features/dim/invitation-ticket.schema.js'
import { Daemon } from '@identity-backend/effect-daemon-spec'
import { Context, Duration, Effect } from 'effect'

const Dims = ['Game', 'ProofOfInk'] as const

export class InvitationTicketNetworkConfig extends Context.Tag('InvitationTicketNetworkConfig')<
  InvitationTicketNetworkConfig,
  { readonly network: Network }
>() {}

export class InvitationTicketWorkerConfig extends Context.Reference<InvitationTicketWorkerConfig>()(
  'InvitationTicketWorkerConfig',
  {
    defaultValue: () => ({
      poolInterval: Duration.seconds(6),
      tickTimeout: Duration.seconds(60),
    }),
  },
) {}

export const make = Effect.fn(function*() {
  const shell = yield* TicketPoolShell
  const config = yield* InvitationTicketWorkerConfig
  const { network } = yield* InvitationTicketNetworkConfig

  const work = Effect.forEach(Dims, (dim) => shell.execute(dim, network))

  return Daemon.poll({
    name: 'invitation-ticket',
    work,
    interval: config.poolInterval,
    tick: {
      spanName: 'invitation_ticket.pool_maintenance_cycle',
      tickTimeout: config.tickTimeout,
    },
    lock: { mode: 'none' },
  })
})
