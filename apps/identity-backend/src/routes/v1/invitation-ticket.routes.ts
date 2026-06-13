import { ClaimCommand, ClaimInvitationTicketShell } from '#root/features/dim/claim-invitation-ticket.shell.js'
import { createOpenAPIHono, ProblemDetailWithErrorsZod, problemResponse } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { createRoute, z } from '@hono/zod-openapi'
import { bridgeSpanContext } from '@identity-backend/observability'
import { toHex } from '@polkadot-api/utils'
import { Cause, Effect, Exit, Runtime, Schema as S } from 'effect'
import { ClaimInvitationTicketBody, ClaimInvitationTicketResponse } from './invitation-ticket.schema.js'

const claimRoute = createRoute({
  method: 'post',
  path: '/claim',
  tags: ['v1', 'invitation-ticket'],
  summary: 'Claim Invitation Ticket',
  description: 'Claims an invitation ticket for a DIM, returning a signature',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ClaimInvitationTicketBody,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ClaimInvitationTicketResponse,
        },
      },
      description: 'Ticket claimed successfully',
    },
    400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Validation Error' },
    401: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Unauthorized — invalid or missing JWT',
    },
    409: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Ticket race lost — another request claimed the same ticket',
    },
    422: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Pool exhausted — no tickets available',
    },
    500: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Internal Server Error',
    },
  },
})

export const makeInvitationTicketRouteWithoutDependencies = Effect.gen(function*() {
  const shell = yield* ClaimInvitationTicketShell
  const runtime = yield* Effect.runtime()

  return createOpenAPIHono()
    .openapi(claimRoute, async (c) => {
      const body = c.req.valid('json')
      const cmd = S.decodeSync(ClaimCommand)({ who: body.who, dim: body.dim })

      const handler = shell.execute(cmd).pipe(
        Effect.map((result) =>
          c.json(
            {
              publicKey: toHex(result.publicKey),
              inviter: result.inviter,
              dim: result.dim,
              network: result.network,
              claimedBy: result.claimedBy,
              createdAt: result.createdAt.toISOString(),
              claimedAt: result.claimedAt.toISOString(),
              signature: toHex(result.signature),
              remaining: result.remaining,
            },
            200,
          )
        ),
        Effect.catchTags({
          PoolExhaustedError: () => Effect.succeed(c.json({ error: 'Pool exhausted' }, 422)),
          TicketRaceError: () => Effect.succeed(c.json({ error: 'Ticket race lost' }, 409)),
        }),
        Effect.withSpan('v1.claim_invitation_ticket'),
      )

      const result = await bridgeSpanContext(handler, c).pipe(
        withRouteTimeout,
        Effect.exit,
        Runtime.runPromise(runtime),
      )

      if (Exit.isFailure(result)) {
        throw Cause.squash(result.cause)
      }

      return result.value
    })
})

export const makeInvitationTicketRoute = Effect.fn('v1.make_invitation_ticket_route')(() =>
  makeInvitationTicketRouteWithoutDependencies
)
