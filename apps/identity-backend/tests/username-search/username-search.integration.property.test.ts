import { DB, DBTest } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { CursorPaginationService } from '#root/lib/cursor-pagination/mod.js'
import { SearchUsernamesV1RouteConfig } from '#root/routes/v1/username/search/username-search.config.js'
import { makeSearchUsernamesRouteWithoutDependencies } from '#root/routes/v1/username/search/username-search.routes.js'
import { it } from '@effect/vitest'
import { checkResponse } from '@identity-backend/testing/hono'
import { Effect, Layer, pipe } from 'effect'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { testClient } from 'hono/testing'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { collectAllPages } from '../helpers/pagination.js'
import { generateUsernameData } from '../helpers/test-data.js'

describe('PaginationInvariants', () => {
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
      const app = new Hono().route('/', route).onError((err, c) => {
        if (err instanceof HTTPException) return err.getResponse()
        return c.json({ error: 'Internal Server Error' }, 500)
      })
      return testClient(app)
    }),
  )

  type Client = Effect.Effect.Success<typeof makeClient>

  const makeSearchFetcher = (client: Client, prefix: string, limit: number) => (cursor: string | undefined) =>
    Effect.promise(() => client.search.$get({ header: {}, query: { prefix, limit, ...(cursor && { cursor }) } })).pipe(
      Effect.filterOrDie(
        (res): res is Extract<typeof res, { status: 200 }> => res.status === 200,
        () => new Error('Expected 200 response'),
      ),
      Effect.flatMap((res) => Effect.promise(() => res.json())),
      Effect.map((body) => ({
        items: body.usernames.map((u) => u.username),
        nextCursor: body.nextCursor,
      })),
    )

  const cleanUp = Effect.andThen(DB, (db) => db.delete(schema.individualityUsernames).execute())
    .pipe(Effect.orDie)

  it.layer(layer)((it) => {
    it.scoped('Should_ReturnNoDuplicates_When_PaginatingWithLimit1', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        // --- @arrange: Insert multiple usernames to test single-item pagination ---
        const db = yield* DB
        const records = Array.from({ length: 5 }, (_, i) =>
          generateUsernameData({ username: 'dup', digits: String(i + 1), network: 'westend2' }, 100 + i))
        yield* Effect.tryPromise(() =>
          db.insert(schema.individualityUsernames).values(records)
        )

        // --- @act: Paginate through all results one at a time ---
        const client = yield* makeClient
        const collected = yield* collectAllPages(makeSearchFetcher(client, 'dup', 1))

        // --- @assert: All records retrieved exactly once ---
        expect(new Set(collected).size, 'no duplicates').toBe(collected.length)
        expect(collected.length, 'all 5 records collected').toBe(5)
      }))

    it.scoped('Should_ReturnNoDuplicates_When_PageBoundaryUneven', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        // --- @arrange: Insert usernames where total count is not divisible by page size ---
        const db = yield* DB
        const records = Array.from({ length: 7 }, (_, i) =>
          generateUsernameData({ username: 'uneven', digits: String(i + 1), network: 'westend2' }, 200 + i))
        yield* Effect.tryPromise(() =>
          db.insert(schema.individualityUsernames).values(records)
        )

        // --- @act: Paginate through all results, forcing a partial final page ---
        const client = yield* makeClient
        const collected = yield* collectAllPages(makeSearchFetcher(client, 'uneven', 3))

        // --- @assert: All records collected without duplicates across page boundaries ---
        expect(new Set(collected).size, 'no duplicates').toBe(collected.length)
        expect(collected.length, 'all 7 records collected').toBe(7)
      }))

    it.scoped('Should_ReturnIdenticalResults_When_SameCursorUsedTwice', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        // --- @arrange: Insert enough usernames to span multiple pages ---
        const db = yield* DB
        const records = Array.from({ length: 10 }, (_, i) =>
          generateUsernameData({ username: 'idem', digits: String(i + 1), network: 'westend2' }, 300 + i))
        yield* Effect.tryPromise(() =>
          db.insert(schema.individualityUsernames).values(records)
        )

        // --- @act: Fetch first page, then reuse the same cursor twice concurrently ---
        const client = yield* makeClient
        const res1 = yield* Effect.promise(() =>
          client.search.$get({ header: {}, query: { prefix: 'idem', limit: 5 } })
        )
        checkResponse(res1, 200)
        const body1 = yield* Effect.promise(() => res1.json())
        expect(body1.nextCursor, 'should have next cursor').not.toBeNull()

        const cursor = body1.nextCursor!
        const [res2, res3] = yield* Effect.all([
          Effect.promise(() => client.search.$get({ header: {}, query: { prefix: 'idem', limit: 5, cursor } })),
          Effect.promise(() => client.search.$get({ header: {}, query: { prefix: 'idem', limit: 5, cursor } })),
        ])
        checkResponse(res2, 200)
        checkResponse(res3, 200)
        const body2 = yield* Effect.promise(() => res2.json())
        const body3 = yield* Effect.promise(() => res3.json())

        // --- @assert: Same cursor returns identical results (idempotency) ---
        expect(body2.usernames.map((u) => u.username), 'results identical')
          .toEqual(body3.usernames.map((u) => u.username))
        expect(body2.nextCursor, 'cursors identical').toEqual(body3.nextCursor)
      }))
  })
})
