import { DB, DBTest } from '#root/db/drizzle.js'
import { relations } from '#root/db/mod.js'
import * as schema from '#root/db/schema.js'
import { ClaimInvitationTicketShell, ClaimTicketConfig } from '#root/features/dim/claim-invitation-ticket.shell.js'
import { InvitationTicketInviterConfig, TicketPoolShell } from '#root/features/dim/invitation-ticket-pool.shell.js'
import { InvitationTicketNetworkConfig } from '#root/supervision/invitation-ticket/workers/invitation-ticket.worker.js'
import { it as effectIt, layer as effectLayer } from '@effect/vitest'
import { makeFeature } from '@identity-backend/effect-vitest-gherkin'
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy'
import { Duration, Layer } from 'effect'
import { vi } from 'vitest'
import { MOCK_INVITER } from './constants.js'
import { FakeInviterSignerServiceLayer } from './fakes/inviter-signer.js'
import { OnChainTicketAPITestLayer } from './fakes/onchain-api.js'

const DimTicketFakesLayer = Layer.mergeAll(
  OnChainTicketAPITestLayer,
  FakeInviterSignerServiceLayer,
)

const shellLayer = Layer.provideMerge(
  Layer.mergeAll(
    ClaimInvitationTicketShell.Default,
    Layer.provide(
      TicketPoolShell.DefaultWithoutDependencies,
      Layer.mergeAll(
        Layer.succeed(InvitationTicketInviterConfig, { inviterAddress: MOCK_INVITER, proxyAs: undefined }),
        DimTicketFakesLayer,
      ),
    ),
  ),
  Layer.mergeAll(
    DimTicketFakesLayer,
    Layer.succeed(InvitationTicketNetworkConfig, { network: 'westend2' }),
  ),
).pipe(
  Layer.fresh,
)

export const testLayer = Layer.provideMerge(shellLayer, DBTest)

const makeFailingDBLayer = (
  queryFn: RemoteCallback,
): Layer.Layer<DB> => Layer.succeed(DB, drizzle<typeof schema, typeof relations>(queryFn, { relations }))

export const infraScenarioLayer = Layer.provideMerge(
  shellLayer,
  Layer.mergeAll(
    makeFailingDBLayer(vi.fn(async () => {
      throw new Error('simulated DB connection failure')
    })),
    Layer.succeed(ClaimTicketConfig, {
      dbRetryMaxRetries: 0,
      dbRetryBaseDelay: Duration.millis(0),
      dbRetryFactor: 2,
    }),
  ),
)

export const feature = makeFeature({ it: effectIt, layer: effectLayer })
