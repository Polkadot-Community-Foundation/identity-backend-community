import { DB, DBTest } from '#root/db/drizzle.js'
import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { describe, expect, it, vi } from '@effect/vitest'
import * as schema from '@identity-backend/db/Schema'
import { checkResponse } from '@identity-backend/testing/hono'
import { Effect, Layer, pipe } from 'effect'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { testClient } from 'hono/testing'
import { afterEach } from 'vitest'
import { makeGetUsernameRouteWithoutDependencies } from '../get.js'
import { makeListUsernamesRouteWithoutDependencies } from '../list.js'
import { GetUsernamesV1RouteConfig } from '../types.js'

describe('GetUsernamesV1 routes', () => {
  describe('makeGetUsernameRoute', () => {
    const mockGetNetwork = vi.fn<GetUsernamesV1RouteConfig['Type']['getNetwork']>()

    const layer = Layer.mergeAll(
      Layer.succeed(GetUsernamesV1RouteConfig, {
        getNetwork: mockGetNetwork,
      }),
      DBTest,
      DefectReporter.NoOp,
    )

    afterEach(() => {
      mockGetNetwork.mockReset()
    })

    const makeClient = pipe(
      makeGetUsernameRouteWithoutDependencies,
      Effect.map((route) => {
        const app = new Hono().route('/', route).onError((err, c) => {
          if (err instanceof HTTPException) {
            return err.getResponse()
          }
          return c.json({ error: 'Internal Server Error' }, 500)
        })

        return testClient(app)
      }),
    )

    it.layer(layer)((it) => {
      it.effect('Should_ReturnUsername_When_UsernameExists', () =>
        Effect.gen(function*() {
          mockGetNetwork.mockReturnValue(Effect.succeed('polkadot'))

          const db = yield* DB

          const createdAt = new Date('2024-01-01T00:00:00Z')
          const updatedAt = new Date('2024-01-02T00:00:00Z')

          yield* Effect.tryPromise(async () => {
            await db.insert(schema.individualityUsernames).values({
              username: 'charlie',
              reservedUsername: null,
              digits: '11',
              network: 'polkadot',
              candidateAccountId: '5FbRAkhDvNVecNzHLFxBNXFXNwvBaV69S1W3nfBbnxYypkkT',
              candidateSignature: '',
              ringVrfKey: '',
              proofOfOwnership: '',
              consumerRegistrationSignature: '',
              identifierKey: '',
              status: 'ASSIGNED',
              onchainData: {
                blockHash: '0x123',
                blockNumber: 42,
                blockIndex: 3,
                eventIndex: 1,
              },
              createdAt,
              updatedAt,
            })
          })

          const client = yield* makeClient

          const res = yield* Effect.promise(() =>
            client[':username'].$get({
              param: { username: 'charlie.11' },
            })
          )

          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect(body).toEqual({
            candidateAccountId: '5FbRAkhDvNVecNzHLFxBNXFXNwvBaV69S1W3nfBbnxYypkkT',
            username: 'charlie.11',
            status: 'ASSIGNED',
            onchainData: {
              blockHash: '0x123',
              blockNumber: 42,
              blockIndex: 3,
              eventIndex: 1,
            },
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
          })
        }))

      it.effect('Should_Return404_When_UsernameDoesNotExist', () =>
        Effect.gen(function*() {
          mockGetNetwork.mockReturnValue(Effect.succeed('polkadot'))

          const client = yield* makeClient

          const res = yield* Effect.promise(() =>
            client[':username'].$get({
              param: { username: 'missing.01' },
            })
          )

          checkResponse(res, 404)
          const body = yield* Effect.promise(() => res.json())
          expect(body).toEqual({ error: 'Username not found' })
        }))

      it.effect('Should_Return400_When_UsernameFormatIsInvalid', () =>
        Effect.gen(function*() {
          mockGetNetwork.mockReturnValue(Effect.succeed('polkadot'))

          const client = yield* makeClient

          const res = yield* Effect.promise(() =>
            client[':username'].$get({
              param: { username: 'invalid-username' },
            })
          )

          checkResponse(res, 400)
        }))
    })
  })

  describe('makeListUsernamesRoute', () => {
    const mockGetNetwork = vi.fn<GetUsernamesV1RouteConfig['Type']['getNetwork']>()

    const layer = Layer.mergeAll(
      Layer.succeed(GetUsernamesV1RouteConfig, {
        getNetwork: mockGetNetwork,
      }),
      DBTest,
      DefectReporter.NoOp,
    )

    afterEach(() => {
      mockGetNetwork.mockReset()
    })

    const makeClient = pipe(
      makeListUsernamesRouteWithoutDependencies,
      Effect.map((route) => {
        const app = new Hono().route('/', route).onError((err, c) => {
          if (err instanceof HTTPException) {
            return err.getResponse()
          }
          return c.json({ error: 'Internal Server Error' }, 500)
        })

        return testClient(app)
      }),
    )

    const seedUsernames = (network: 'westend2' | 'paseo' | 'polkadot') =>
      Effect.gen(function*() {
        const db = yield* DB

        const now = new Date('2024-01-01T00:00:00Z')

        yield* Effect.tryPromise(async () => {
          const records: (typeof schema.individualityUsernames.$inferInsert)[] = [
            {
              username: 'alice',
              reservedUsername: null,
              digits: '00',
              network,
              candidateAccountId: 'alice-account',
              candidateSignature: '',
              ringVrfKey: '',
              proofOfOwnership: '',
              consumerRegistrationSignature: '',
              identifierKey: '',
              status: 'ASSIGNED',
              onchainData: {
                blockHash: '0xaaa',
                blockNumber: 1,
                blockIndex: 2,
                eventIndex: 3,
              },
              createdAt: now,
              updatedAt: now,
            },
            {
              username: 'alice',
              reservedUsername: null,
              digits: '01',
              network,
              candidateAccountId: 'alice-failed',
              candidateSignature: '',
              ringVrfKey: '',
              proofOfOwnership: '',
              consumerRegistrationSignature: '',
              identifierKey: '',
              status: 'FAILED',
              onchainData: null,
              createdAt: now,
              updatedAt: null,
            },
            {
              username: 'bob',
              reservedUsername: null,
              digits: '00',
              network,
              candidateAccountId: 'bob-reserved',
              candidateSignature: '',
              ringVrfKey: '',
              proofOfOwnership: '',
              consumerRegistrationSignature: '',
              identifierKey: '',
              status: 'RESERVED',
              onchainData: null,
              createdAt: now,
              updatedAt: now,
            },
            {
              username: 'bob',
              reservedUsername: null,
              digits: '99',
              network,
              candidateAccountId: 'bob-other',
              candidateSignature: '',
              ringVrfKey: '',
              proofOfOwnership: '',
              consumerRegistrationSignature: '',
              identifierKey: '',
              status: 'RESERVED',
              onchainData: null,
              createdAt: now,
              updatedAt: now,
            },
          ]

          for (const record of records) {
            await db
              .insert(schema.individualityUsernames)
              .values(record)
          }
        })
      })

    it.layer(layer)((it) => {
      it.effect('Should_ReturnUsernames_When_ConfiguredNetworkMatches', () =>
        Effect.gen(function*() {
          mockGetNetwork.mockReturnValue(Effect.succeed('polkadot'))

          const db = yield* DB
          yield* Effect.tryPromise(async () => {
            await db
              .delete(schema.individualityUsernames)
              .execute()
          })

          yield* seedUsernames('polkadot')
          // add another network entry to make sure it is filtered out
          yield* Effect.tryPromise(async () => {
            await db.insert(schema.individualityUsernames).values({
              username: 'carol',
              reservedUsername: null,
              digits: '00',
              network: 'westend2',
              candidateAccountId: 'carol-account',
              candidateSignature: '',
              ringVrfKey: '',
              proofOfOwnership: '',
              consumerRegistrationSignature: '',
              identifierKey: '',
              status: 'ASSIGNED',
              onchainData: null,
              createdAt: new Date(),
              updatedAt: null,
            })
          })

          const client = yield* makeClient

          const res = yield* Effect.promise(() => client.index.$get({ query: {} }))

          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect(body).toEqual([
            {
              candidateAccountId: 'alice-account',
              username: 'alice.00',
              status: 'ASSIGNED',
              onchainData: {
                blockHash: '0xaaa',
                blockNumber: 1,
                blockIndex: 2,
                eventIndex: 3,
              },
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
            {
              candidateAccountId: 'alice-failed',
              username: 'alice.01',
              status: 'FAILED',
              onchainData: null,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: null,
            },
            {
              candidateAccountId: 'bob-reserved',
              username: 'bob.00',
              status: 'RESERVED',
              onchainData: null,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
            {
              candidateAccountId: 'bob-other',
              username: 'bob.99',
              status: 'RESERVED',
              onchainData: null,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ])
        }))

      it.effect('Should_SupportPrefixAndStatusFilters_When_FilteringUsernames', () =>
        Effect.gen(function*() {
          mockGetNetwork.mockReturnValue(Effect.succeed('polkadot'))

          const db = yield* DB
          yield* Effect.tryPromise(async () => {
            await db
              .delete(schema.individualityUsernames)
              .execute()
          })

          yield* seedUsernames('polkadot')

          const client = yield* makeClient

          const prefixRes = yield* Effect.promise(() =>
            client.index.$get({
              query: {
                prefix: 'ali',
              },
            })
          )
          checkResponse(prefixRes, 200)
          const prefixBody = yield* Effect.promise(() => prefixRes.json())
          expect(prefixBody).toHaveLength(2)
          expect(
            prefixBody.map(
              (item: { username: string }) => item.username,
            ),
          ).toEqual(['alice.00', 'alice.01'])

          const statusAssignedRes = yield* Effect.promise(() =>
            client.index.$get({
              query: {
                status: 'ASSIGNED',
              },
            })
          )
          checkResponse(statusAssignedRes, 200)
          const statusAssignedBody = yield* Effect.promise(() => statusAssignedRes.json())
          expect(statusAssignedBody).toEqual([
            expect.objectContaining({
              username: 'alice.00',
              status: 'ASSIGNED',
            }),
          ])

          const statusFailedRes = yield* Effect.promise(() =>
            client.index.$get({
              query: {
                status: 'FAILED',
              },
            })
          )
          checkResponse(statusFailedRes, 200)
          const statusFailedBody = yield* Effect.promise(() => statusFailedRes.json())
          expect(statusFailedBody).toEqual([
            expect.objectContaining({
              username: 'alice.01',
              status: 'FAILED',
            }),
          ])
        }))

      it.effect('Should_FilterOnDigitsCorrectly_When_PrefixWithDigits', () =>
        Effect.gen(function*() {
          mockGetNetwork.mockReturnValue(Effect.succeed('polkadot'))

          const db = yield* DB
          yield* Effect.tryPromise(async () => {
            await db
              .delete(schema.individualityUsernames)
              .execute()
          })

          yield* seedUsernames('polkadot')

          const client = yield* makeClient

          const prefixRes = yield* Effect.promise(() =>
            client.index.$get({
              query: {
                prefix: 'bob.9',
              },
            })
          )
          checkResponse(prefixRes, 200)
          const prefixBody = yield* Effect.promise(() => prefixRes.json())
          expect(prefixBody).toHaveLength(1)
          expect(
            prefixBody.map(
              (item: { username: string }) => item.username,
            ),
          ).toEqual(['bob.99'])
        }))

      it.effect('Should_ExcludeUsernames_When_DigitSuffixExceedsV1Bound', () =>
        Effect.gen(function*() {
          mockGetNetwork.mockReturnValue(Effect.succeed('polkadot'))

          const db = yield* DB
          yield* Effect.tryPromise(async () => {
            await db
              .delete(schema.individualityUsernames)
              .execute()
          })

          const now = new Date('2024-01-01T00:00:00Z')
          yield* Effect.tryPromise(async () => {
            const records: (typeof schema.individualityUsernames.$inferInsert)[] = [
              {
                username: 'alice',
                reservedUsername: null,
                digits: '01',
                network: 'polkadot',
                candidateAccountId: 'alice-v1',
                candidateSignature: '',
                ringVrfKey: '',
                proofOfOwnership: '',
                consumerRegistrationSignature: '',
                identifierKey: '',
                status: 'ASSIGNED',
                onchainData: null,
                createdAt: now,
                updatedAt: now,
              },
              {
                username: 'alice',
                reservedUsername: null,
                digits: '123',
                network: 'polkadot',
                candidateAccountId: 'alice-chain-import',
                candidateSignature: '',
                ringVrfKey: '',
                proofOfOwnership: '',
                consumerRegistrationSignature: '',
                identifierKey: '',
                status: 'ASSIGNED',
                onchainData: null,
                createdAt: now,
                updatedAt: now,
              },
            ]

            for (const record of records) {
              await db
                .insert(schema.individualityUsernames)
                .values(record)
            }
          })

          const client = yield* makeClient

          const res = yield* Effect.promise(() =>
            client.index.$get({
              query: {
                prefix: 'alice',
              },
            })
          )
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect(
            body.map((item: { username: string }) => item.username),
          ).toEqual(['alice.01'])
        }))

      it.effect('Should_NotExcludeFullUsernames_When_DigitsExceedV1Bound', () =>
        Effect.gen(function*() {
          mockGetNetwork.mockReturnValue(Effect.succeed('polkadot'))

          const db = yield* DB
          yield* Effect.tryPromise(async () => {
            await db
              .delete(schema.individualityUsernames)
              .execute()
          })

          const now = new Date('2024-01-01T00:00:00Z')
          yield* Effect.tryPromise(async () => {
            const records: (typeof schema.individualityUsernames.$inferInsert)[] = [
              {
                username: 'alice',
                fullUsername: 'alice_smith',
                reservedUsername: null,
                digits: '123',
                network: 'polkadot',
                candidateAccountId: 'alice-smith-chain',
                candidateSignature: '',
                ringVrfKey: '',
                proofOfOwnership: '',
                consumerRegistrationSignature: '',
                identifierKey: '',
                status: 'ASSIGNED',
                onchainData: null,
                createdAt: now,
                updatedAt: now,
              },
            ]

            for (const record of records) {
              await db
                .insert(schema.individualityUsernames)
                .values(record)
            }
          })

          const client = yield* makeClient

          const res = yield* Effect.promise(() =>
            client.index.$get({
              query: {
                prefix: 'alice',
              },
            })
          )
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect(
            body.map((item: { username: string }) => item.username),
          ).toEqual(['alice_smith'])
        }))

      it.effect('Should_MatchAndRenderFullUsername_When_PrefixMatchesFullColumn', () =>
        Effect.gen(function*() {
          mockGetNetwork.mockReturnValue(Effect.succeed('polkadot'))

          const db = yield* DB
          yield* Effect.tryPromise(async () => {
            await db
              .delete(schema.individualityUsernames)
              .execute()
          })

          const now = new Date('2024-01-01T00:00:00Z')
          yield* Effect.tryPromise(async () => {
            await db.insert(schema.individualityUsernames).values({
              username: 'smith',
              fullUsername: 'alice_smith',
              reservedUsername: null,
              digits: '07',
              network: 'polkadot',
              candidateAccountId: 'alice-smith-account',
              candidateSignature: '',
              ringVrfKey: '',
              proofOfOwnership: '',
              consumerRegistrationSignature: '',
              identifierKey: '',
              status: 'ASSIGNED',
              onchainData: null,
              createdAt: now,
              updatedAt: now,
            })
          })

          const client = yield* makeClient

          const fullRes = yield* Effect.promise(() =>
            client.index.$get({
              query: {
                prefix: 'alice',
              },
            })
          )
          checkResponse(fullRes, 200)
          const fullBody = yield* Effect.promise(() => fullRes.json())
          expect(
            fullBody.map(
              (item: { username: string }) => item.username,
            ),
          ).toEqual(['alice_smith'])

          const dottedRes = yield* Effect.promise(() =>
            client.index.$get({
              query: {
                prefix: 'smith.',
              },
            })
          )
          checkResponse(dottedRes, 200)
          const dottedBody = yield* Effect.promise(() => dottedRes.json())
          expect(dottedBody).toEqual([])
        }))
    })
  })
})
