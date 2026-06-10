import { DB } from '#root/db/drizzle.js'
import { SelectIndividualityUsernameWithDigitsSchema } from '#root/db/individuality.adapter.js'
import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { CursorPaginationService, paginateWithCursor } from '#root/lib/cursor-pagination/mod.js'
import { createOpenAPIHono, ProblemDetailWithErrorsZod, problemResponse } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { cursorPaginationMiddlewareFactory } from '#root/middleware/cursor-pagination.middleware.js'
import { bridgeSpanContext } from '#root/tracing/bridge-span-context.js'
import { createRoute, z } from '@hono/zod-openapi'

import { classifySearchPrefix } from '#root/routes/v1/username/username-prefix-match.js'
import { searchUsernames } from '#root/routes/v1/username/username-prefix-match.store.js'
import { Array, Cause, Effect, Exit, Layer, Runtime, Schema as S } from 'effect'
import { SearchUsernamesV1RouteConfig } from './username-search.config.js'
import { SearchUsernamesV1QuerySchema, SearchUsernamesV1ResponseSchema } from './username-search.dto.js'

const DEFAULT_SEARCH_LIMIT = 100
const MAX_SEARCH_LIMIT = 1000

// #region Schemas

type UsernameDbRecord = S.Schema.Type<typeof SelectIndividualityUsernameWithDigitsSchema>

export const CursorDataSchema = S.Struct({
  username: S.String,
  digits: S.Number.pipe(S.positive(), S.int()),
  timestamp: S.compose(S.DateFromString, S.ValidDateFromSelf),
})

export type CursorData = S.Schema.Type<typeof CursorDataSchema>

// #endregion

// #region Route

const searchUsernamesRoute = createRoute({
  summary: 'Search Usernames',
  method: 'get',
  path: '/search',
  tags: ['v1'],
  security: [{ bearerAuth: [] }],
  request: {
    query: SearchUsernamesV1QuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SearchUsernamesV1ResponseSchema } },
      description: 'Search results with cursor pagination',
    },
    400: {
      ...problemResponse(ProblemDetailWithErrorsZod),
      description: 'Bad Request - Invalid cursor, missing prefix, or prefix too long',
    },
    500: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Internal Server Error',
    },
  },
})

namespace SearchUsernames {
  export interface QueryParams {
    network: 'westend2' | 'paseo' | 'polkadot'
    prefix: string
    cursor: CursorData | null
    limit: number
  }
}

export const makeSearchUsernamesRouteWithoutDependencies = Effect.gen(function*() {
  const db = yield* DB
  const config = yield* SearchUsernamesV1RouteConfig
  const network = yield* config.getNetwork()
  const runtime = yield* Effect.runtime<CursorPaginationService>()
  const defectReporter = yield* DefectReporter

  const executeQuery = Effect.fn('username_search.execute_query')(
    function*({ network, prefix, cursor, limit }: SearchUsernames.QueryParams) {
      const kind = classifySearchPrefix(prefix)

      const rows = yield* searchUsernames({ network, prefix, cursor, limit })

      yield* Effect.annotateCurrentSpan({
        'search.prefix': prefix,
        'search.prefix_kind': kind,
        'search.limit': limit,
        'db.table': 'individuality_usernames',
      })

      const [corruptRows, items] = Array.separate(
        rows.map((row) => S.decodeUnknownEither(SelectIndividualityUsernameWithDigitsSchema)(row)),
      )

      if (corruptRows.length > 0) {
        yield* Effect.logWarning(
          `skipped ${corruptRows.length}/${rows.length} corrupt username row(s) during search`,
        ).pipe(
          Effect.annotateLogs({
            skipped: corruptRows.length,
            total: rows.length,
          }),
        )

        yield* defectReporter.captureException(
          Cause.die(
            new AggregateError(
              corruptRows,
              `${corruptRows.length} corrupt username row(s) out of ${rows.length} in search endpoint`,
            ),
          ),
        )
      }

      return items
    },
  )

  const mapUsernamesToResponse = (includeOnchainData: boolean) => (items: UsernameDbRecord[]) => {
    return items.map((item) => ({
      accountId: item.candidateAccountId,
      username: item.fullUsername ?? `${item.username}.${item.digits}`,
      status: item.status,
      onchainData: includeOnchainData ? item.onchainData : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
  }

  return createOpenAPIHono<{ Variables: { validatedCursor?: CursorData } }>()
    .openapi(searchUsernamesRoute, async (c) => {
      const { prefix, limit, includeOnchainData } = c.req.valid('query')
      const validatedCursor = c.get('validatedCursor')

      const effectiveLimit = Math.min(limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT)
      const cursor = validatedCursor ?? null

      const handler = Effect.gen(function*() {
        const items = yield* executeQuery({ network, prefix, cursor, limit: effectiveLimit })
        const { pageItems, nextCursor } = yield* paginateWithCursor({
          items,
          limit: effectiveLimit,
          schema: CursorDataSchema,
          extractCursor: (item) => ({ username: item.username, digits: item.digits }),
        })
        const usernames = mapUsernamesToResponse(includeOnchainData ?? false)(pageItems)

        return { usernames, nextCursor }
      }).pipe(
        Effect.withSpan('v1.search_usernames'),
      )

      const result = await bridgeSpanContext(handler, c).pipe(
        Effect.map((value) => {
          const encoded = SearchUsernamesV1ResponseSchema.encode(value)
          return c.json(encoded, 200)
        }),
        withRouteTimeout,
        Effect.provideService(DB, db),
        Effect.exit,
        Runtime.runPromise(runtime),
      )

      if (Exit.isFailure(result)) {
        throw Cause.squash(result.cause)
      }

      return result.value
    })
}).pipe(
  Effect.andThen((route) =>
    Effect.gen(function*() {
      const cursorValidator = yield* cursorPaginationMiddlewareFactory(CursorDataSchema)

      return yield* Effect.succeed(
        createOpenAPIHono<{ Variables: { validatedCursor?: CursorData } }>(),
      ).pipe(
        Effect.tap((app) => app.use('*', cursorValidator)),
        Effect.map((app) => app.route('/', route)),
      )
    })
  ),
)

export const makeSearchUsernamesRoute = Effect.fn('v1.make_search_usernames_route')(() =>
  makeSearchUsernamesRouteWithoutDependencies.pipe(
    Effect.provide(Layer.unwrapEffect(Effect.gen(function*() {
      const { layerSearchUsernamesV1Routes } = yield* Effect.promise(() => import('./username-search.layer.js'))

      return layerSearchUsernamesV1Routes
    }))),
  )
)

// #endregion
