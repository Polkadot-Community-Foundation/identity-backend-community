import { DB } from '#root/db/drizzle.js'
import type { DimTicket } from '#root/db/schema.js'
import * as schema from '#root/db/schema.js'
import { DimTicketDaemonShell } from '#root/features/dim/dim-ticket-daemon.shell.js'
import { DimTicketShell } from '#root/features/dim/dim-ticket.shell.js'
import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { makeDIMTicketRouteWithoutDependencies } from '#root/routes/v1/dim-ticket.routes.js'
import { afterEach, describe, expect, it, vi } from '@effect/vitest'
import { checkResponse } from '@identity-backend/testing/hono'

import { ConfigProvider, Effect, Layer, pipe, TestClock } from 'effect'
import { HTTPException } from 'hono/http-exception'
import { testClient } from 'hono/testing'
import {
  BatchRegistrationResult,
  makeCheckQuotaMock,
  makeDimTicketInfraLayer,
  makeRegisterBatchMock,
  MOCK_BLOCK_HASH,
  MOCK_BLOCK_NUMBER,
  MOCK_INVITER,
} from './helpers/dim-ticket-test-layer.js'

const MAX_RETRIES = 5

const SS58_A = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
const SS58_B = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const SS58_C = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y'
const SS58_D = '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy'
const SS58_E = '5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc'

const insertTicket = (
  db: DB['Type'],
  overrides: Partial<typeof schema.dimTickets.$inferInsert> & { ticket: string },
) =>
  Effect.tryPromise(() =>
    db.insert(schema.dimTickets).values({
      inviter: MOCK_INVITER,
      network: 'polkadot',
      dim: 'Game',
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      ...overrides,
    })
  )

const readTicket = (db: DB['Type'], ticket: string) =>
  Effect.tryPromise(() => db.query.dimTickets.findFirst({ where: { ticket: { eq: ticket } } }))

const cleanUp = Effect.andThen(DB, (db) => db.delete(schema.dimTickets).execute()).pipe(Effect.orDie)

const withCleanup = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    yield* Effect.addFinalizer(() => cleanUp)
    return yield* eff
  })

const makeTicketRow = (overrides: Partial<DimTicket> & { ticket: string }): DimTicket => ({
  network: 'polkadot',
  dim: 'Game',
  inviter: SS58_A,
  status: 'PENDING',
  registered: false,
  onchainData: null,
  retryAt: null,
  retryCount: 0,
  traceId: null,
  spanId: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: null,
  ...overrides,
})

const makeClient = pipe(
  makeDIMTicketRouteWithoutDependencies,
  Effect.map((route) => {
    const app = createOpenAPIHono().route('/', route).onError((err, c) => {
      if (err instanceof HTTPException) return err.getResponse()
      return c.json({ error: 'Internal Server Error' }, 500)
    })
    return testClient(app)
  }),
  Effect.provide(Layer.setConfigProvider(ConfigProvider.fromJson({ PEOPLE_NETWORK: 'paseo' }))),
)

const makeNetworkClient = (network: string) =>
  pipe(
    makeDIMTicketRouteWithoutDependencies,
    Effect.map((route) => {
      const app = createOpenAPIHono().route('/', route).onError((err, c) => {
        if (err instanceof HTTPException) return err.getResponse()
        return c.json({ error: 'Internal Server Error' }, 500)
      })
      return testClient(app)
    }),
    Effect.provide(Layer.setConfigProvider(ConfigProvider.fromJson({ PEOPLE_NETWORK: network }))),
  )

describe('DimTicket Integration', () => {
  const registerBatch = makeRegisterBatchMock()
  const checkQuota = makeCheckQuotaMock()
  const infraLayer = makeDimTicketInfraLayer(registerBatch, checkQuota)

  const layer = Layer.mergeAll(
    Layer.provide(DimTicketShell.Default, infraLayer),
    Layer.provide(DimTicketDaemonShell.DefaultWithoutDependencies, infraLayer),
    infraLayer,
  )

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    checkQuota.mockReturnValue(Effect.succeed(5))
  })

  it.layer(layer)((it) => {
    it.scoped('Should_RegisterTicket_When_RouteThenDaemon', () =>
      withCleanup(Effect.gen(function*() {
        const NOW = new Date('2025-06-01T12:00:00Z').getTime()
        yield* TestClock.setTime(NOW)

        registerBatch.mockReturnValue(
          Effect.succeed(
            new BatchRegistrationResult({
              completedIndices: [0],
              failedIndices: [],
              blockHash: MOCK_BLOCK_HASH,
              blockNumber: MOCK_BLOCK_NUMBER,
            }),
          ),
        )

        const client = yield* makeClient
        const shell = yield* DimTicketDaemonShell

        const postRes = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_A, dim: 'Game' } }))
        checkResponse(postRes, 200)
        const postBody = yield* Effect.promise(() => postRes.json())
        expect.soft(postBody.status).toBe('PENDING')
        expect.soft(postBody.inviter).not.toBe(SS58_A)

        const pending = yield* shell.fetchPendingTickets(NOW, 10)
        expect.soft(pending).toHaveLength(1)
        expect.soft(pending[0]!.ticket).toBe(SS58_A)

        yield* shell.processTickets(pending, NOW, MAX_RETRIES)
        expect.soft(registerBatch).toHaveBeenCalledOnce()

        const db = yield* DB
        const row = yield* readTicket(db, SS58_A)
        expect.soft(row?.status).toBe('REGISTERED')
      })))

    describe('Route contract', () => {
      it.scoped('Should_Return422_When_QuotaExceeded', () =>
        withCleanup(Effect.gen(function*() {
          checkQuota.mockReturnValue(Effect.succeed(0))

          const client = yield* makeClient

          const res = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_A, dim: 'Game' } }))
          checkResponse(res, 422)
          const body = yield* Effect.promise(() => res.json() as Promise<{ error: string; available: number }>)
          expect.soft(body.error).toBe('No available invites')
          expect.soft(body.available).toBe(0)
          expect.soft(checkQuota).toHaveBeenCalledWith({ inviter: MOCK_INVITER, dim: 'Game' })
        })))

      it.scoped('Should_Return400WithProblemDetails_When_BodyInvalid', () =>
        Effect.gen(function*() {
          const client = yield* makeClient

          const res = yield* Effect.promise(() =>
            client.index.$post({ json: { who: '', dim: 'InvalidDim' as 'Game' } })
          )

          expect(res.status).toBe(400)
          expect(res.headers.get('content-type')).toBe('application/problem+json')
        }))

      it.scoped('Should_RoundTrip_When_CreatedViaPOSTAndReadViaGET', () =>
        withCleanup(Effect.gen(function*() {
          const client = yield* makeClient

          const postRes = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_A, dim: 'Game' } }))
          checkResponse(postRes, 200, 'POST should create ticket')
          const postBody = yield* Effect.promise(() => postRes.json())

          expect.soft(postBody).toMatchObject({
            ticket: SS58_A,
            who: SS58_A,
            status: 'PENDING',
            registered: false,
            dim: 'Game',
          })
          expect.soft(postBody.createdAt).toBeDefined()
          expect.soft(postBody.updatedAt).toBeDefined()

          const getRes = yield* Effect.promise(() => client[':who'].$get({ param: { who: SS58_A } }))
          checkResponse(getRes, 200, 'GET should find the created ticket')
          const getBody = yield* Effect.promise(() => getRes.json())
          expect.soft(getBody).toMatchObject({ ticket: SS58_A, status: 'PENDING' })
        })))

      it.scoped('Should_CreateProofOfInkTicket_When_DimIsProofOfInk', () =>
        withCleanup(Effect.gen(function*() {
          const client = yield* makeClient
          const res = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_A, dim: 'ProofOfInk' } }))
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())
          expect.soft(body).toMatchObject({ dim: 'ProofOfInk', status: 'PENDING' })
        })))

      it.scoped('Should_Return404_When_TicketDoesNotExist', () =>
        Effect.gen(function*() {
          const client = yield* makeClient
          const res = yield* Effect.promise(() => client[':who'].$get({ param: { who: SS58_A } }))
          checkResponse(res, 404)
          const body = yield* Effect.promise(() => res.json() as Promise<{ error: string }>)
          expect.soft(body.error).toBe('Ticket not found')
        }))

      it.scoped('Should_Return409_When_DuplicateTicket', () =>
        withCleanup(Effect.gen(function*() {
          const client = yield* makeClient
          const first = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_A, dim: 'Game' } }))
          checkResponse(first, 200)
          const duplicate = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_A, dim: 'Game' } }))
          expect.soft(duplicate.status).toBe(409)
        })))

      it.scoped('Should_RejectTicket_When_TicketEqualsInviter', () =>
        Effect.gen(function*() {
          const client = yield* makeClient
          const res = yield* Effect.promise(() => client.index.$post({ json: { who: MOCK_INVITER, dim: 'Game' } }))
          expect.soft(res.status).not.toBe(200)
        }))

      it.scoped('Should_CreateSeparateTickets_When_DifferentAddresses', () =>
        withCleanup(Effect.gen(function*() {
          const client = yield* makeClient
          const res1 = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_A, dim: 'Game' } }))
          checkResponse(res1, 200)
          const res2 = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_B, dim: 'Game' } }))
          checkResponse(res2, 200)
          const body1 = yield* Effect.promise(() => res1.json())
          const body2 = yield* Effect.promise(() => res2.json())
          expect.soft(body1.ticket).toBe(SS58_A)
          expect.soft(body2.ticket).toBe(SS58_B)
        })))

      it.scoped('Should_ReturnCorrectTicket_When_MultipleTicketsExist', () =>
        withCleanup(Effect.gen(function*() {
          const client = yield* makeClient
          const res1 = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_A, dim: 'Game' } }))
          checkResponse(res1, 200)
          const res2 = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_B, dim: 'ProofOfInk' } }))
          checkResponse(res2, 200)

          const getRes = yield* Effect.promise(() => client[':who'].$get({ param: { who: SS58_B } }))
          checkResponse(getRes, 200)
          const body = yield* Effect.promise(() => getRes.json())
          expect.soft(body.ticket).toBe(SS58_B)
          expect.soft(body.dim).toBe('ProofOfInk')
        })))
    })

    describe('GET /:who — status contract', () => {
      it.scoped.each([
        { status: 'PENDING' as const, registered: false, onchainData: null },
        { status: 'SUBMITTED' as const, registered: false },
        { status: 'SUBMITTING' as const, responseStatus: 'SUBMITTED' as const, registered: false },
        {
          status: 'REGISTERED' as const,
          registered: true,
          onchainData: { blockIndex: '0xabc', blockNumber: 99, blockHash: '0xdef', eventIndex: 2 },
        },
        { status: 'FAILED' as const, registered: false },
      ])(
        'Should_ReturnCorrectStatus_When_TicketIs$status',
        ({ status, registered, onchainData, responseStatus }) =>
          withCleanup(Effect.gen(function*() {
            const db = yield* DB
            const timestamp = status === 'PENDING'
              ? new Date('2025-01-01T00:00:00Z')
              : status === 'SUBMITTED'
              ? new Date('2025-01-01T02:00:00Z')
              : status === 'SUBMITTING'
              ? new Date('2025-01-01T01:00:00Z')
              : status === 'REGISTERED'
              ? new Date('2025-01-01T03:00:00Z')
              : new Date('2025-01-01T04:00:00Z')
            yield* insertTicket(db, {
              ticket: SS58_A,
              status,
              updatedAt: timestamp,
              ...(onchainData && { onchainData }),
            })
            const client = yield* makeClient
            const res = yield* Effect.promise(() => client[':who'].$get({ param: { who: SS58_A } }))
            checkResponse(res, 200)
            const body = yield* Effect.promise(() => res.json())
            const expectedStatus = responseStatus ?? status
            expect.soft(body).toMatchObject({ status: expectedStatus, registered, ...(onchainData && { onchainData }) })
          })),
      )
    })

    describe('fetchPendingTickets — query behaviour', () => {
      const NOW = new Date('2025-06-01T12:00:00Z').getTime()

      it.scoped('Should_ReturnOnlyPENDING_When_MixedStatuses', () =>
        withCleanup(Effect.gen(function*() {
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          yield* insertTicket(db, { ticket: SS58_A, status: 'PENDING' })
          yield* insertTicket(db, { ticket: SS58_B, status: 'REGISTERED' })
          const tickets = yield* shell.fetchPendingTickets(NOW, 10)
          expect.soft(tickets).toHaveLength(1)
          expect.soft(tickets[0]!.ticket).toBe(SS58_A)
        })))

      it.scoped('Should_IncludeSUBMITTED_When_RetryAtHasPassed', () =>
        withCleanup(Effect.gen(function*() {
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          yield* insertTicket(db, { ticket: SS58_A, status: 'SUBMITTED', retryAt: new Date(NOW - 60_000) })
          yield* insertTicket(db, { ticket: SS58_B, status: 'SUBMITTED', retryAt: new Date(NOW + 60_000) })
          const tickets = yield* shell.fetchPendingTickets(NOW, 10)
          expect.soft(tickets).toHaveLength(1)
          expect.soft(tickets[0]!.ticket).toBe(SS58_A)
        })))

      it.scoped('Should_ExcludeFAILEDAndREGISTERED_When_Fetching', () =>
        withCleanup(Effect.gen(function*() {
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          yield* insertTicket(db, { ticket: SS58_A, status: 'FAILED' })
          yield* insertTicket(db, { ticket: SS58_B, status: 'REGISTERED' })
          yield* insertTicket(db, { ticket: SS58_C, status: 'PENDING' })
          const tickets = yield* shell.fetchPendingTickets(NOW, 10)
          expect.soft(tickets).toHaveLength(1)
          expect.soft(tickets[0]!.ticket).toBe(SS58_C)
        })))

      it.scoped('Should_RespectBatchSize_When_ManyTicketsPending', () =>
        withCleanup(Effect.gen(function*() {
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          const addresses = [SS58_A, SS58_B, SS58_C, SS58_D, SS58_E]
          yield* Effect.forEach(addresses, (ticket) => insertTicket(db, { ticket }), { concurrency: 1 })
          const tickets = yield* shell.fetchPendingTickets(NOW, 3)
          expect.soft(tickets).toHaveLength(3)
        })))
    })

    describe('processTickets — orchestration', () => {
      const NOW = new Date('2025-06-01T12:00:00Z').getTime()

      const mockSuccess = Effect.succeed(
        new BatchRegistrationResult({
          completedIndices: [0],
          failedIndices: [],
          blockHash: MOCK_BLOCK_HASH,
          blockNumber: MOCK_BLOCK_NUMBER,
        }),
      )

      it.scoped('Should_OrchestrateFullSubmission_When_TicketSucceeds', () =>
        withCleanup(Effect.gen(function*() {
          yield* TestClock.setTime(NOW)
          registerBatch.mockReturnValue(mockSuccess)
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          yield* insertTicket(db, { ticket: SS58_A, status: 'PENDING', dim: 'Game' })
          yield* shell.processTickets([makeTicketRow({ ticket: SS58_A })], NOW, MAX_RETRIES)
          const row = yield* readTicket(db, SS58_A)
          expect.soft(row?.status).toBe('REGISTERED')
          expect.soft(row?.registered).toBe(true)
        })))

      it.scoped('Should_HandleMixedResults_When_BatchPartiallySucceeds', () =>
        withCleanup(Effect.gen(function*() {
          yield* TestClock.setTime(NOW)
          registerBatch.mockReturnValue(
            Effect.succeed(
              new BatchRegistrationResult({
                completedIndices: [0],
                failedIndices: [1],
                blockHash: MOCK_BLOCK_HASH,
                blockNumber: MOCK_BLOCK_NUMBER,
              }),
            ),
          )
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          yield* insertTicket(db, { ticket: SS58_A, status: 'PENDING', dim: 'Game' })
          yield* insertTicket(db, { ticket: SS58_B, status: 'PENDING', dim: 'Game' })
          yield* shell.processTickets(
            [makeTicketRow({ ticket: SS58_A }), makeTicketRow({ ticket: SS58_B })],
            NOW,
            MAX_RETRIES,
          )
          const rowA = yield* readTicket(db, SS58_A)
          const rowB = yield* readTicket(db, SS58_B)
          expect.soft(rowA?.status).toBe('REGISTERED')
          expect.soft(rowB?.status).toBe('PENDING')
          expect.soft(rowB?.retryCount).toBe(1)
          expect.soft(rowB?.retryAt?.getTime()).toBeGreaterThan(NOW)
        })))

      it.scoped('Should_MarkFAILED_When_TicketsMarkedExhausted', () =>
        withCleanup(Effect.gen(function*() {
          yield* TestClock.setTime(NOW)
          registerBatch.mockReturnValue(mockSuccess)
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          yield* insertTicket(db, { ticket: SS58_A, retryCount: MAX_RETRIES, dim: 'Game' })
          yield* shell.processTickets([makeTicketRow({ ticket: SS58_A, retryCount: MAX_RETRIES })], NOW, MAX_RETRIES)
          const row = yield* readTicket(db, SS58_A)
          expect.soft(row?.status).toBe('FAILED')
        })))

      it.scoped('Should_ResubmitOrphaned_When_SubmittedTicketHasPastRetryAt', () =>
        withCleanup(Effect.gen(function*() {
          yield* TestClock.setTime(NOW)
          registerBatch.mockReturnValue(mockSuccess)
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          yield* insertTicket(db, { ticket: SS58_A, status: 'SUBMITTED', retryAt: new Date(NOW - 60_000), dim: 'Game' })
          yield* shell.processTickets(
            [makeTicketRow({ ticket: SS58_A, status: 'SUBMITTED', retryAt: new Date(NOW - 60_000) })],
            NOW,
            MAX_RETRIES,
          )
          const row = yield* readTicket(db, SS58_A)
          expect.soft(row?.status).toBe('REGISTERED')
        })))

      it.scoped('Should_IncrementRetryCountAndSetFutureRetryAt_When_TicketFailsWithExistingRetries', () =>
        withCleanup(Effect.gen(function*() {
          yield* TestClock.setTime(NOW)
          registerBatch.mockReturnValue(
            Effect.succeed(
              new BatchRegistrationResult({
                completedIndices: [],
                failedIndices: [0],
                blockHash: MOCK_BLOCK_HASH,
                blockNumber: MOCK_BLOCK_NUMBER,
              }),
            ),
          )
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          yield* insertTicket(db, { ticket: SS58_A, status: 'PENDING', dim: 'Game', retryCount: 2 })
          yield* shell.processTickets(
            [makeTicketRow({ ticket: SS58_A, retryCount: 2 })],
            NOW,
            MAX_RETRIES,
          )
          const row = yield* readTicket(db, SS58_A)
          expect.soft(row?.status).toBe('PENDING')
          expect.soft(row?.retryCount).toBe(3)
          expect.soft(row?.retryAt?.getTime()).toBeGreaterThan(NOW)
        })))

      it.scoped('Should_OnlySubmitBatchTickets_When_ExhaustedAndPendingMixed', () =>
        withCleanup(Effect.gen(function*() {
          yield* TestClock.setTime(NOW)
          registerBatch.mockReturnValue(
            Effect.succeed(
              new BatchRegistrationResult({
                completedIndices: [0],
                failedIndices: [],
                blockHash: MOCK_BLOCK_HASH,
                blockNumber: MOCK_BLOCK_NUMBER,
              }),
            ),
          )
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          yield* insertTicket(db, { ticket: SS58_A, status: 'PENDING', dim: 'Game', retryCount: MAX_RETRIES })
          yield* insertTicket(db, { ticket: SS58_B, status: 'PENDING', dim: 'Game', retryCount: 0 })

          yield* shell.processTickets(
            [
              makeTicketRow({ ticket: SS58_A, retryCount: MAX_RETRIES }),
              makeTicketRow({ ticket: SS58_B, retryCount: 0 }),
            ],
            NOW,
            MAX_RETRIES,
          )

          const rowA = yield* readTicket(db, SS58_A)
          const rowB = yield* readTicket(db, SS58_B)
          expect.soft(rowA?.status).toBe('FAILED')
          expect.soft(rowB?.status).toBe('REGISTERED')
        })))

      it.scoped('Should_TolerateOutOfBoundsIndices_When_BlockchainReturnsBadResult', () =>
        withCleanup(Effect.gen(function*() {
          yield* TestClock.setTime(NOW)
          registerBatch.mockReturnValue(
            Effect.succeed(
              new BatchRegistrationResult({
                completedIndices: [0, 99],
                failedIndices: [99],
                blockHash: MOCK_BLOCK_HASH,
                blockNumber: MOCK_BLOCK_NUMBER,
              }),
            ),
          )
          const db = yield* DB
          const shell = yield* DimTicketDaemonShell
          yield* insertTicket(db, { ticket: SS58_A, status: 'PENDING', dim: 'Game' })
          yield* shell.processTickets(
            [makeTicketRow({ ticket: SS58_A })],
            NOW,
            MAX_RETRIES,
          )
          const row = yield* readTicket(db, SS58_A)
          expect.soft(row?.status).toBe('REGISTERED')
        })))
    })

    describe('Network configuration', () => {
      it.scoped.each([
        'polkadot',
        'paseo',
        'westend2',
      ])(
        'Should_CreateTicketWithCorrectNetwork_When_PeopleNetworkIs%s',
        (network) =>
          withCleanup(Effect.gen(function*() {
            const client = yield* makeNetworkClient(network)

            const res = yield* Effect.promise(() => client.index.$post({ json: { who: SS58_A, dim: 'Game' } }))
            checkResponse(res, 200)
            const body = yield* Effect.promise(() => res.json())
            expect.soft(body.network).toBe(network)

            const db = yield* DB
            const row = yield* readTicket(db, SS58_A)
            expect.soft(row?.network).toBe(network)
          })),
      )
    })
  })
})
