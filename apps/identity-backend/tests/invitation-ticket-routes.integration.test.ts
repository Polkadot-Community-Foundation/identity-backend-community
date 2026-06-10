import { DB, DBTest } from '#root/db/drizzle.js'
import { MOCK_INVITER } from '#root/features/dim/__tests__/helpers/constants.js'
import {
  insertAvailableTickets,
  insertClaimedTicket,
  readTicket,
  withCleanup,
} from '#root/features/dim/__tests__/helpers/db-helpers.js'
import { generateTestTicket } from '#root/features/dim/__tests__/helpers/factories.js'
import { ClaimInvitationTicketShell } from '#root/features/dim/claim-invitation-ticket.shell.js'
import { createOpenAPIHono, ProblemDetailWithErrorsZod } from '#root/lib/problem-details.js'
import { makeInvitationTicketRouteWithoutDependencies } from '#root/routes/v1/invitation-ticket.routes.js'
import { ClaimInvitationTicketResponse } from '#root/routes/v1/invitation-ticket.schema.js'
import { InvitationTicketNetworkConfig } from '#root/supervision/invitation-ticket/workers/invitation-ticket.worker.js'
import { describe, expect, it } from '@effect/vitest'
import { checkResponse } from '@identity-backend/testing/hono'
import { toHex } from '@polkadot-api/utils'
import { Effect, Layer, pipe } from 'effect'
import { HTTPException } from 'hono/http-exception'
import { testClient } from 'hono/testing'
import { TestTracingLive } from './helpers/tracing.js'

const DIM_GAME = 'Game' as const
const DIM_PROOF_OF_INK = 'ProofOfInk' as const
const NETWORK_WESTEND2 = 'westend2' as const
const SS58_ADDRESS = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
const SS58_ADDRESS_B = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

const makeClient = pipe(
  makeInvitationTicketRouteWithoutDependencies,
  Effect.map((route) => {
    const app = createOpenAPIHono().route('/', route).onError((err, c) => {
      if (err instanceof HTTPException) return err.getResponse()
      return c.json({ error: 'Internal Server Error' }, 500)
    })
    return testClient(app)
  }),
)

const layer = ClaimInvitationTicketShell.Default.pipe(
  Layer.provide(Layer.succeed(
    InvitationTicketNetworkConfig,
    { network: 'westend2' },
  )),
  Layer.fresh,
)

describe('Invitation Ticket Routes', () => {
  it.layer(Layer.mergeAll(TestTracingLive, DBTest))((it) => {
    it.layer(layer)((it) => {
      it.scoped('Should_Return400_When_InvalidAddressFormat', () =>
        withCleanup(
          Effect.gen(function*() {
            const client = yield* makeClient

            const res = yield* Effect.promise(() =>
              client.claim.$post({ json: { who: 'not-an-address', dim: 'Game' } })
            )

            checkResponse(res, 400)
            expect(res.headers.get('content-type')).toBe('application/problem+json')
            const body = yield* Effect.promise(() => res.json() as Promise<unknown>)
            expect(body).toEqual(expect.schemaMatching(ProblemDetailWithErrorsZod))
          }),
        ))
    })

    it.layer(layer)((it) => {
      it.scoped('Should_Return400_When_MalformedRequestBody', () =>
        withCleanup(
          Effect.gen(function*() {
            const client = yield* makeClient

            const res = yield* Effect.promise(() => client.claim.$post({ json: {} as { who: string; dim: 'Game' } }))

            checkResponse(res, 400)
            expect(res.headers.get('content-type')).toBe('application/problem+json')
            const body = yield* Effect.promise(() => res.json() as Promise<unknown>)
            expect(body).toEqual(expect.schemaMatching(ProblemDetailWithErrorsZod))
          }),
        ))
    })

    it.layer(layer)((it) => {
      it.scoped('Should_Return200AndPersistState_When_TicketAvailable', () =>
        withCleanup(
          Effect.gen(function*() {
            const db = yield* DB
            const client = yield* makeClient

            const ticket = yield* generateTestTicket
            yield* insertAvailableTickets(db, [{ publicKey: ticket.publicKey, privateKey: ticket.privateKey }])

            const res = yield* Effect.promise(() =>
              client.claim.$post({
                json: { who: SS58_ADDRESS, dim: DIM_GAME },
              })
            )

            checkResponse(res, 200)
            const body = yield* Effect.promise(() => res.json())
            expect(body).toEqual(expect.schemaMatching(ClaimInvitationTicketResponse))
            expect(body).toMatchObject({
              claimedBy: SS58_ADDRESS,
              inviter: MOCK_INVITER,
              dim: DIM_GAME,
              network: NETWORK_WESTEND2,
              remaining: 0,
            })

            const row = yield* readTicket(db, ticket.publicKey)
            expect(row).toMatchObject({ state: 'claimed', claimedBy: SS58_ADDRESS })
            expect(row?.claimedAt).toBeInstanceOf(Date)
          }),
        ))
    })

    it.layer(layer)((it) => {
      it.scoped('Should_Return422_When_NoTicketsAvailable', () =>
        withCleanup(
          Effect.gen(function*() {
            const client = yield* makeClient

            const res = yield* Effect.promise(() =>
              client.claim.$post({
                json: { who: SS58_ADDRESS, dim: DIM_GAME },
              })
            )

            checkResponse(res, 422)
            expect(yield* Effect.promise(() => res.json())).toMatchObject({ error: 'Pool exhausted' })
          }),
        ))
    })

    it.layer(layer)((it) => {
      it.scoped('Should_Return422_When_WrongPoolRequested', () =>
        withCleanup(
          Effect.gen(function*() {
            const db = yield* DB
            const client = yield* makeClient

            const ticket = yield* generateTestTicket
            yield* insertAvailableTickets(db, [
              { publicKey: ticket.publicKey, privateKey: ticket.privateKey, dim: DIM_GAME },
            ])

            const res = yield* Effect.promise(() =>
              client.claim.$post({
                json: { who: SS58_ADDRESS, dim: DIM_PROOF_OF_INK },
              })
            )

            checkResponse(res, 422)
            expect(yield* Effect.promise(() => res.json())).toMatchObject({ error: 'Pool exhausted' })
          }),
        ))
    })

    it.layer(layer)((it) => {
      it.scoped('Should_Return422_When_AllTicketsConsumed', () =>
        withCleanup(
          Effect.gen(function*() {
            const db = yield* DB
            const client = yield* makeClient

            const ticket = yield* generateTestTicket
            yield* insertClaimedTicket(db, { publicKey: ticket.publicKey, claimedBy: SS58_ADDRESS })

            const res = yield* Effect.promise(() =>
              client.claim.$post({
                json: { who: SS58_ADDRESS, dim: DIM_GAME },
              })
            )

            checkResponse(res, 422)
            expect(yield* Effect.promise(() => res.json())).toMatchObject({ error: 'Pool exhausted' })
          }),
        ))
    })

    it.layer(layer)((it) => {
      it.scoped('Should_Return422_When_RetryingAfterSuccess', () =>
        withCleanup(
          Effect.gen(function*() {
            const db = yield* DB
            const client = yield* makeClient

            const ticket = yield* generateTestTicket
            yield* insertAvailableTickets(db, [{ publicKey: ticket.publicKey, privateKey: ticket.privateKey }])

            const first = yield* Effect.promise(() =>
              client.claim.$post({
                json: { who: SS58_ADDRESS, dim: DIM_GAME },
              })
            )
            checkResponse(first, 200)

            const retry = yield* Effect.promise(() =>
              client.claim.$post({
                json: { who: SS58_ADDRESS, dim: DIM_GAME },
              })
            )
            checkResponse(retry, 422)
            expect(yield* Effect.promise(() => retry.json())).toMatchObject({ error: 'Pool exhausted' })
          }),
        ))
    })

    it.layer(layer)((it) => {
      it.scoped('Should_ConsumeOldestTicket_When_MultipleAvailable', () =>
        withCleanup(
          Effect.gen(function*() {
            const db = yield* DB
            const client = yield* makeClient

            const [tk1, tk2, tk3] = yield* Effect.all([generateTestTicket, generateTestTicket, generateTestTicket])
            yield* insertAvailableTickets(db, [
              { publicKey: tk1.publicKey, privateKey: tk1.privateKey, createdAt: new Date('2025-01-01T00:00:00Z') },
              { publicKey: tk2.publicKey, privateKey: tk2.privateKey, createdAt: new Date('2025-01-01T00:00:01Z') },
              { publicKey: tk3.publicKey, privateKey: tk3.privateKey, createdAt: new Date('2025-01-01T00:00:02Z') },
            ])

            const res = yield* Effect.promise(() =>
              client.claim.$post({
                json: { who: SS58_ADDRESS, dim: DIM_GAME },
              })
            )

            checkResponse(res, 200)
            expect(yield* Effect.promise(() => res.json())).toMatchObject({ remaining: 2 })

            expect(yield* readTicket(db, tk1.publicKey)).toMatchObject({ state: 'claimed' })
          }),
        ))
    })

    it.layer(layer)((it) => {
      it.scoped('Should_AllowOneWinner_When_TwoConcurrentClaims', () =>
        withCleanup(
          Effect.gen(function*() {
            const db = yield* DB
            const client = yield* makeClient

            const ticket = yield* generateTestTicket
            yield* insertAvailableTickets(db, [{ publicKey: ticket.publicKey, privateKey: ticket.privateKey }])

            const results = yield* Effect.all(
              [
                Effect.promise(() => client.claim.$post({ json: { who: SS58_ADDRESS, dim: DIM_GAME } })),
                Effect.promise(() => client.claim.$post({ json: { who: SS58_ADDRESS_B, dim: DIM_GAME } })),
              ],
              { concurrency: 2 },
            )

            const winners = results.filter((r) => r.status === 200)
            const losers = results.filter((r) => r.status === 409 || r.status === 422)
            expect(winners).toHaveLength(1)
            expect(losers).toHaveLength(1)
          }),
        ))
    })

    it.layer(layer)((it) => {
      it.scoped('Should_AllowExactlyOneWinner_When_ManyConcurrentClaims', () =>
        withCleanup(
          Effect.gen(function*() {
            const db = yield* DB
            const client = yield* makeClient

            const ticket = yield* generateTestTicket
            yield* insertAvailableTickets(db, [{ publicKey: ticket.publicKey, privateKey: ticket.privateKey }])

            const claims = Array.from({ length: 10 }, () =>
              Effect.promise(() => client.claim.$post({ json: { who: SS58_ADDRESS, dim: DIM_GAME } })))

            const results = yield* Effect.all(claims, { concurrency: 'unbounded' })
            const winners = results.filter((r) =>
              r.status === 200
            )
            const losers = results.filter((r) => r.status === 409 || r.status === 422)
            expect(winners).toHaveLength(1)
            expect(losers).toHaveLength(9)
          }),
        ))
    })

    it.layer(layer)((it) => {
      it.scoped('Should_NotAffectOtherPool_When_ClaimingFromOnePool', () =>
        withCleanup(
          Effect.gen(function*() {
            const db = yield* DB
            const client = yield* makeClient

            const [gameTicket, inkTicket] = yield* Effect.all([generateTestTicket, generateTestTicket])
            yield* insertAvailableTickets(db, [
              {
                publicKey: gameTicket.publicKey,
                privateKey: gameTicket.privateKey,
                dim: DIM_GAME,
                network: NETWORK_WESTEND2,
              },
              {
                publicKey: inkTicket.publicKey,
                privateKey: inkTicket.privateKey,
                dim: DIM_PROOF_OF_INK,
                network: NETWORK_WESTEND2,
              },
            ])

            const res = yield* Effect.promise(() =>
              client.claim.$post({
                json: { who: SS58_ADDRESS, dim: DIM_GAME },
              })
            )

            checkResponse(res, 200)
            expect(yield* Effect.promise(() => res.json())).toMatchObject({
              dim: DIM_GAME,
              publicKey: toHex(gameTicket.publicKey),
            })

            expect(yield* readTicket(db, inkTicket.publicKey)).toMatchObject({ state: 'available' })
          }),
        ))
    })
  })
})
