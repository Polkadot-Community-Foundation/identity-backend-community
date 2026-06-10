import { DB, DBTest } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { CursorPaginationService } from '#root/lib/cursor-pagination/mod.js'
import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { SearchUsernamesV1RouteConfig } from '#root/routes/v1/username/search/username-search.config.js'
import { makeSearchUsernamesRouteWithoutDependencies } from '#root/routes/v1/username/search/username-search.routes.js'
import { it } from '@effect/vitest'
import { checkResponse } from '@identity-backend/testing/hono'
import { Effect, Layer, pipe } from 'effect'
import { HTTPException } from 'hono/http-exception'
import { testClient } from 'hono/testing'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { collectAllPages } from '../helpers/pagination.js'
import { generatePaginationData, generateUsernameData, generateUsernameDataArray } from '../helpers/test-data.js'

describe('UsernameSearch', () => {
  const mockGetNetwork = vi.fn<SearchUsernamesV1RouteConfig['Type']['getNetwork']>()

  const layer = Layer.mergeAll(
    Layer.succeed(SearchUsernamesV1RouteConfig, { getNetwork: mockGetNetwork }),
    DBTest,
    CursorPaginationService.Default,
    DefectReporter.NoOp,
  )

  beforeAll(() => {
    mockGetNetwork.mockReturnValue(Effect.succeed('westend2' as const))
  })

  afterAll(() => {
    mockGetNetwork.mockReset()
  })

  const makeClient = pipe(
    makeSearchUsernamesRouteWithoutDependencies,
    Effect.map((route) => {
      const app = createOpenAPIHono().route('/', route).onError((err, c) => {
        if (err instanceof HTTPException) return err.getResponse()
        return c.json({ error: 'Internal Server Error' }, 500)
      })
      return testClient(app)
    }),
  )

  const cleanUp = Effect.andThen(DB, (db) => db.delete(schema.individualityUsernames).execute())
    .pipe(Effect.orDie)

  it.layer(layer)((it) => {
    describe('BasicSearch', () => {
      it.scoped('Should_ReturnUsernamesWithPagination_When_ValidPrefix', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with 3 alice records ---
          const db = yield* DB

          const records = [
            generateUsernameData({ username: 'alice', digits: '1', network: 'westend2' }, 10),
            generateUsernameData({ username: 'alice', digits: '2', network: 'westend2' }, 11),
            generateUsernameData({ username: 'alice', digits: '3', network: 'westend2' }, 12),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: Search usernames with prefix 'alice' ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'alice' } }))

          // --- @assert: Response contains 3 usernames with null cursor ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect.soft(body, 'response should have usernames array').toHaveProperty('usernames')
          expect.soft(body, 'response should have nextCursor').toHaveProperty('nextCursor')
          expect.soft(body.usernames, 'should return all 3 matching records').toHaveLength(3)
          expect.soft(body.nextCursor, 'nextCursor should be null when all results fit').toBeNull()
        }))

      it.scoped('Should_ReturnDisplayField_When_AnyUsernameType', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with mixed username types ---
          const db = yield* DB

          const records = [
            generateUsernameData({ username: 'alice', digits: '1', network: 'westend2' }, 20),
            generateUsernameData({ username: 'bob', fullUsername: 'bob', digits: '0', network: 'westend2' }, 21),
            generateUsernameData({
              username: 'valentin',
              digits: '99',
              fullUsername: 'anothername',
              network: 'westend2',
            }, 22),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: Search usernames with prefix 'alice' ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'alice' } }))

          // --- @assert: Response contains non-empty username strings ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect.soft(body.usernames.length, 'should return results').toBeGreaterThan(0)
          expect.soft(
            body.usernames.every((u: { username: string }) => typeof u.username === 'string' && u.username.length > 0),
            'all usernames should be non-empty strings',
          ).toBe(true)
        }))

      it.scoped('Should_MatchCaseInsensitively_When_MixedCasePrefix', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with mixed case usernames ---
          const db = yield* DB

          const records = [
            generateUsernameData({ username: 'usertest', digits: '1', network: 'westend2' }, 65),
            generateUsernameData({ username: 'UserTest', digits: '2', network: 'westend2' }, 66),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: Search with mixed case prefix 'userTEST' ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'userTEST' } }))

          // --- @assert: Case-insensitive matching returns results ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect(body.usernames.length, 'should find usernames regardless of case').toBeGreaterThan(0)
        }))

      it.scoped('Should_OrderDigitsNumerically_When_SameUsername', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with digits that would sort differently as strings vs numbers ---
          const db = yield* DB

          const records = [
            generateUsernameData({ username: 'ordertest', digits: '2', network: 'westend2' }, 90),
            generateUsernameData({ username: 'ordertest', digits: '10', network: 'westend2' }, 91),
            generateUsernameData({ username: 'ordertest', digits: '1', network: 'westend2' }, 92),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: Search for ordertest ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'ordertest' } }))

          // --- @assert: Results ordered numerically (1, 2, 10) not lexicographically (1, 10, 2) ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect(body.usernames.map((u: { username: string }) => u.username)).toEqual([
            'ordertest.1',
            'ordertest.2',
            'ordertest.10',
          ])
        }))
    })

    describe('PrefixSemantics', () => {
      it.scoped('Should_ReturnLiteAndFull_When_PrefixIsBaseOnly', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: lite 'alice.10' and full 'alice' coexist ---
          const db = yield* DB
          const records = [
            generateUsernameData({
              username: 'alicelite',
              digits: '10',
              fullUsername: null,
              network: 'westend2',
            }, 700),
            generateUsernameData({
              username: 'alicefull',
              digits: '0',
              fullUsername: 'alice',
              network: 'westend2',
            }, 701),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: prefix without dot includes both lite and full ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'alice' } }))

          // --- @assert: both representations appear in results ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())
          const names = body.usernames.map((u: { username: string }) => u.username)

          expect.soft(names, 'lite username appears').toContain('alicelite.10')
          expect.soft(names, 'full username appears').toContain('alice')
          expect.soft(names, 'exactly the two records').toHaveLength(2)
        }))

      it.scoped('Should_ReturnLiteOnly_When_PrefixHasTrailingDot', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: shared base with lite and full rows ---
          const db = yield* DB
          const records = [
            generateUsernameData({
              username: 'alice',
              digits: '10',
              fullUsername: null,
              network: 'westend2',
            }, 710),
            generateUsernameData({
              username: 'alice',
              digits: '11',
              fullUsername: null,
              network: 'westend2',
            }, 711),
            generateUsernameData({
              username: 'alice',
              digits: '0',
              fullUsername: 'alice',
              network: 'westend2',
            }, 712),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: trailing dot restricts to lite usernames ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'alice.' } }))

          // --- @assert: only lite forms returned, full excluded ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())
          const names = body.usernames.map((u: { username: string }) => u.username)

          expect.soft(names, 'lite results returned').toEqual(
            expect.arrayContaining(['alice.10', 'alice.11']),
          )
          expect.soft(names, 'full username excluded').not.toContain('alice')
          expect.soft(names, 'only lite rows').toHaveLength(2)
        }))

      it.scoped('Should_ReturnLiteMatchingDigits_When_PrefixHasDigits', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: several lite digits and a full 'alice' ---
          const db = yield* DB
          const records = [
            generateUsernameData({
              username: 'alice',
              digits: '10',
              fullUsername: null,
              network: 'westend2',
            }, 720),
            generateUsernameData({
              username: 'alice',
              digits: '11',
              fullUsername: null,
              network: 'westend2',
            }, 721),
            generateUsernameData({
              username: 'alice',
              digits: '0',
              fullUsername: 'alice',
              network: 'westend2',
            }, 722),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: digits-qualified prefix matches lite rows starting with 'alice.10' ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'alice.10' } }))

          // --- @assert: only the matching lite row is returned ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())
          const names = body.usernames.map((u: { username: string }) => u.username)

          expect.soft(names, 'only alice.10 returned').toEqual(['alice.10'])
        }))
    })

    describe('Pagination', () => {
      it.scoped('Should_ReturnNextCursor_When_MoreResultsExist', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with 3 alice records ---
          const db = yield* DB

          const records = [
            generateUsernameData({ username: 'alice', digits: '1', network: 'westend2' }, 1),
            generateUsernameData({ username: 'alice', digits: '2', network: 'westend2' }, 2),
            generateUsernameData({ username: 'alice', fullUsername: 'alice', digits: '0', network: 'westend2' }, 3),
            generateUsernameData({ username: 'bob', digits: '1', network: 'westend2' }, 4),
            generateUsernameData({ username: 'charlie', digits: '1', network: 'westend2' }, 5),
            ...generatePaginationData('david', 15, 42),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: Search with limit=2 to trigger pagination ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'alice', limit: 2 } }))

          // --- @assert: Returns exactly 2 results with non-null cursor ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect.soft(body.usernames, 'should return exactly limit results').toHaveLength(2)
          expect.soft(body.nextCursor, 'should have cursor for next page').not.toBeNull()
        }))

      it.scoped('Should_ReturnNoOverlap_When_UsingCursor', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with pagination records ---
          const db = yield* DB

          const records = [
            generateUsernameData({ username: 'alice', digits: '1', network: 'westend2' }, 1),
            generateUsernameData({ username: 'alice', digits: '2', network: 'westend2' }, 2),
            generateUsernameData({ username: 'alice', fullUsername: 'alice', digits: '0', network: 'westend2' }, 3),
            generateUsernameData({ username: 'bob', digits: '1', network: 'westend2' }, 4),
            generateUsernameData({ username: 'charlie', digits: '1', network: 'westend2' }, 5),
            ...generatePaginationData('david', 15, 42),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: Fetch first page, then second page using cursor ---
          const res1 = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'david', limit: 10 } }))
          checkResponse(res1, 200)
          const body1 = yield* Effect.promise(() => res1.json())

          const res2 = yield* Effect.promise(() =>
            client.search.$get({ query: { prefix: 'david', limit: 10, cursor: body1.nextCursor ?? undefined } })
          )
          checkResponse(res2, 200)
          const body2 = yield* Effect.promise(() => res2.json())

          const page1 = body1.usernames.map((u) => u.username)
          const page2 = body2.usernames.map((u) => u.username)

          // --- @assert: Pages have no overlapping usernames ---
          expect(page1.some((u: string) => page2.includes(u)), 'pages should not overlap').toBe(false)
        }))

      it.scoped('Should_ReturnAllRecords_When_PaginatingToEnd', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with pagination records ---
          const db = yield* DB

          const records = [
            generateUsernameData({ username: 'alice', digits: '1', network: 'westend2' }, 1),
            generateUsernameData({ username: 'alice', digits: '2', network: 'westend2' }, 2),
            generateUsernameData({ username: 'alice', fullUsername: 'alice', digits: '0', network: 'westend2' }, 3),
            generateUsernameData({ username: 'bob', digits: '1', network: 'westend2' }, 4),
            generateUsernameData({ username: 'charlie', digits: '1', network: 'westend2' }, 5),
            ...generatePaginationData('david', 15, 42),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: Paginate through all pages until cursor is null ---
          const allUsernames = yield* collectAllPages((cursor) =>
            Effect.promise(() => client.search.$get({ query: { prefix: 'david', limit: 10, cursor } })).pipe(
              Effect.filterOrDie(
                (res): res is Extract<typeof res, { status: 200 }> => res.status === 200,
                () => new Error('Expected 200 response'),
              ),
              Effect.flatMap((res) => Effect.promise(() => res.json())),
              Effect.map((body) => ({
                items: body.usernames.map((u: { username: string }) => u.username),
                nextCursor: body.nextCursor,
              })),
            )
          )

          // --- @assert: All 15 records collected with no duplicates ---
          expect.soft(allUsernames, 'should return all 15 david records').toHaveLength(15)
          expect.soft(new Set(allUsernames).size, 'should have no duplicates').toBe(15)
        }))

      it.scoped('Should_ReturnEmptyAndNullCursor_When_NoMatches', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange with empty database ---
          const client = yield* makeClient

          // --- @act: Search for non-existent prefix ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'nonexistent' } }))

          // --- @assert: Returns empty array with null cursor ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect.soft(body.usernames, 'should return empty array').toEqual([])
          expect.soft(body.nextCursor, 'should return null cursor').toBeNull()
        }))
    })

    describe('Limits', () => {
      it.scoped('Should_Return100Results_When_LimitNotSpecified', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with 120 records ---
          const db = yield* DB

          const records = [
            ...generateUsernameDataArray(60, { username: 'defaultlimita', network: 'westend2' }, 0),
            ...generateUsernameDataArray(60, { username: 'defaultlimitb', network: 'westend2' }, 100),
          ]
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: Search without specifying limit ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'defaultlimit' } }))

          // --- @assert: Returns default limit of 100 results ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect(body.usernames, 'should apply default limit of 100').toHaveLength(100)
        }))

      it.scoped('Should_CapAt1000_When_LimitExceedsMaximum', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with 50 records ---
          const db = yield* DB

          const records = generateUsernameDataArray(50, { username: 'limituser', network: 'westend2' }, 41)
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

          const client = yield* makeClient

          // --- @act: Search with excessive limit of 2000 ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'limituser', limit: 2000 } }))

          // --- @assert: Results capped at maximum 1000 ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          expect(body.usernames.length, 'should cap at maximum 1000').toBeLessThanOrEqual(1000)
        }))
    })

    describe('Validation', () => {
      it.scoped('Should_Return400_When_CursorMalformed', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          const client = yield* makeClient

          const res = yield* Effect.promise(() =>
            client.search.$get({ query: { prefix: 'alice', cursor: 'invalid-cursor' } })
          )

          expect(res.status, 'invalid cursor should be rejected').toBe(400)
        }))

      it.scoped('Should_Return400WithProblemDetails_When_PrefixInvalid', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          const client = yield* makeClient

          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'invalid@chars!' } }))

          expect(res.status).toBe(400)
          expect(res.headers.get('content-type')).toBe('application/problem+json')
        }))

      it.scoped('Should_Return400_When_PrefixHasNonDigitAfterDot', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          const client = yield* makeClient

          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'alice.1a' } }))

          expect(res.status, 'prefix with non-digits after dot is rejected').toBe(400)
        }))

      it.scoped('Should_Return400_When_PrefixHasMultipleDots', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          const client = yield* makeClient

          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'alice..10' } }))

          expect(res.status, 'prefix with multiple dots is rejected').toBe(400)
        }))
    })

    describe('OnchainData', () => {
      it.scoped('Should_IncludeOnchainData_When_FlagTrue', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with onchain data ---
          const db = yield* DB

          const record = generateUsernameData({ username: 'alice', digits: '1', network: 'westend2' }, 80)
          record.onchainData = { blockHash: '0x1234567890abcdef', blockNumber: 12345, blockIndex: 1 }
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values([record]))

          const client = yield* makeClient

          // --- @act: Search with includeOnchainData=true ---
          const res = yield* Effect.promise(() =>
            client.search.$get({ query: { prefix: 'alice', includeOnchainData: 'true' } })
          )

          // --- @assert: Response includes onchain data ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          const alice = body.usernames.find((u: { username: string }) => u.username === 'alice.1')
          expect(alice?.onchainData, 'onchainData should be present').toMatchObject({
            blockHash: expect.any(String),
            blockNumber: expect.any(Number),
            blockIndex: expect.any(Number),
          })
        }))

      it.scoped('Should_ExcludeOnchainData_When_FlagNotSet', () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)

          // --- @arrange: database with onchain data ---
          const db = yield* DB

          const record = generateUsernameData({ username: 'alice', digits: '1', network: 'westend2' }, 81)
          record.onchainData = { blockHash: '0x1234567890abcdef', blockNumber: 12345, blockIndex: 1 }
          yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values([record]))

          const client = yield* makeClient

          // --- @act: Search without includeOnchainData flag ---
          const res = yield* Effect.promise(() => client.search.$get({ query: { prefix: 'alice' } }))

          // --- @assert: Response excludes onchain data ---
          checkResponse(res, 200)
          const body = yield* Effect.promise(() => res.json())

          const alice = body.usernames.find((u) => u.username === 'alice.1')
          expect(alice?.onchainData, 'onchainData should be null by default').toBeNull()
        }))
    })
  })
})
