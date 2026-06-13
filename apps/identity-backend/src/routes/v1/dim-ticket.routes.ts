import { PEOPLE_NETWORK } from '#root/config.js'
import { DimTicketShell } from '#root/features/dim/dim-ticket.shell.js'
import { createOpenAPIHono, ProblemDetailWithErrorsZod, problemResponse } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { createRoute, z } from '@hono/zod-openapi'
import {
  FailedTicket,
  PendingTicket,
  RegisteredTicket,
  SubmittedTicket,
  SubmittingTicket,
} from '@identity-backend/dim-ticket'
import { bridgeSpanContext } from '@identity-backend/observability'
import { Cause, Clock, Effect, Exit, Match, Runtime } from 'effect'
import { DIMTicketCreateResponse, RequestTicketBody, TicketResponse } from './dim-ticket.schema.js'

const ticketStatusToResponse = (
  ticket:
    | PendingTicket
    | SubmittedTicket
    | SubmittingTicket
    | RegisteredTicket
    | FailedTicket,
  now: Date,
) =>
  Match.value(ticket).pipe(
    Match.tag('PendingTicket', (t) => ({
      ticket: t.ticket,
      inviter: t.inviter,
      network: t.network,
      dim: t.dim,
      status: 'PENDING' as const,
      registered: false,
      onchainData: null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: now.toISOString(),
    })),
    Match.tag('SubmittingTicket', (t) => ({
      ticket: t.ticket,
      inviter: t.inviter,
      network: t.network,
      dim: t.dim,
      status: 'SUBMITTED' as const,
      registered: false,
      onchainData: null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.submittedAt.toISOString(),
    })),
    Match.tag('SubmittedTicket', (t) => ({
      ticket: t.ticket,
      inviter: t.inviter,
      network: t.network,
      dim: t.dim,
      status: 'SUBMITTED' as const,
      registered: false,
      onchainData: null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.submittedAt.toISOString(),
    })),
    Match.tag('RegisteredTicket', (t) => ({
      ticket: t.ticket,
      inviter: t.inviter,
      network: t.network,
      dim: t.dim,
      status: 'REGISTERED' as const,
      registered: true,
      onchainData: t.onchainData,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.registeredAt.toISOString(),
    })),
    Match.tag('FailedTicket', (t) => ({
      ticket: t.ticket,
      inviter: t.inviter,
      network: t.network,
      dim: t.dim,
      status: 'FAILED' as const,
      registered: false,
      onchainData: null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.failedAt.toISOString(),
    })),
    Match.exhaustive,
  )

const getTicketRoute = createRoute({
  method: 'get',
  path: '/:who',
  tags: ['v1', 'dim-ticket'],
  security: [{ bearerAuth: [] }],
  summary: 'Get DIM Ticket Status',
  description: 'Returns ticket status for a given SS58 address',
  request: {
    params: z.object({
      who: z.string().openapi({
        param: { name: 'who', in: 'path' },
        example: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
      }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: TicketResponse,
        },
      },
      description: 'Ticket status',
    },
    404: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Ticket not found',
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

const requestTicketRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['v1', 'dim-ticket'],
  summary: 'Request DIM Ticket',
  description: 'Requests a new ticket for a DIM (Game or ProofOfInk)',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: RequestTicketBody,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: DIMTicketCreateResponse,
        },
      },
      description: 'Ticket created',
    },
    400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
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
      description: 'Ticket already exists',
    },
    422: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'No available invites',
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

export const makeDIMTicketRouteWithoutDependencies = Effect.gen(function*() {
  const shell = yield* DimTicketShell
  const network = yield* PEOPLE_NETWORK
  const runtime = yield* Effect.runtime()

  return createOpenAPIHono()
    .openapi(getTicketRoute, async (c) => {
      const { who } = c.req.valid('param')

      const handler = Effect.gen(function*() {
        const now = new Date(yield* Clock.currentTimeMillis)
        const ticket = yield* shell.getTicketOrFail(who)
        const response = ticketStatusToResponse(ticket, now)
        return c.json(TicketResponse.parse(response), 200)
      }).pipe(
        Effect.catchTags({
          DimTicketNotFoundError: () => Effect.succeed(c.json({ error: 'Ticket not found' }, 404)),
        }),
        Effect.withSpan('v1.get_dim_ticket'),
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
    .openapi(requestTicketRoute, async (c) => {
      const { who, dim } = c.req.valid('json')

      const handler = shell.createTicket({
        ticket: who,
        network,
        dim,
      }).pipe(
        Effect.map((ticket) => {
          const response = {
            ticket: ticket.ticket,
            who: ticket.ticket,
            inviter: ticket.inviter,
            network: ticket.network,
            dim: ticket.dim,
            status: 'PENDING' as const,
            registered: false,
            createdAt: ticket.createdAt.toISOString(),
            updatedAt: new Date().toISOString(),
          }
          return c.json(DIMTicketCreateResponse.parse(response), 200)
        }),
        Effect.catchTags({
          DimTicketAlreadyExistsError: () => Effect.succeed(c.json({ error: 'Ticket already exists' }, 409)),
          DimTicketQuotaExceededError: () =>
            Effect.succeed(c.json({
              error: 'No available invites',
            }, 422)),
        }),
        Effect.withSpan('v1.create_dim_ticket'),
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

export const makeDIMTicketRoute = Effect.fn('v1.make_dim_ticket_route')(() => makeDIMTicketRouteWithoutDependencies)
