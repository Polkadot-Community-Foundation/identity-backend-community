import { DB } from '#root/db/drizzle.js'
import { SelectIndividualityUsernameSchema } from '#root/db/individuality.adapter.js'
import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { createOpenAPIHono, ProblemDetailWithErrorsZod, problemResponse } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { listUsernames } from '#root/routes/v1/username/username-prefix-match.store.js'
import type { HttpBindings } from '@hono/node-server'
import { createRoute, z } from '@hono/zod-openapi'
import { bridgeSpanContext } from '@identity-backend/observability'
import type { SpanContext } from '@opentelemetry/api'
import { Array, Cause, Effect, Exit, Layer, Runtime, Schema as S } from 'effect'
import { GetUsernamesV1RouteConfig, makeUsernameDTO } from './types.js'

const MAX_USERNAMES_LIMIT = 1000

export const makeListUsernamesRouteWithoutDependencies = Effect.gen(function*() {
  const {
    getNetwork,
  } = yield* GetUsernamesV1RouteConfig
  const db = yield* DB
  const runtime = yield* Effect.runtime()
  const defectReporter = yield* DefectReporter

  const config = yield* Effect.all({
    network: getNetwork(),
  })

  return createOpenAPIHono<{
    Bindings: HttpBindings
    Variables: {
      spanContext?: SpanContext
    }
  }>()
    .openapi(
      createRoute({
        summary: 'Get Usernames',
        method: 'get',
        path: '/',
        tags: ['v1'],
        security: [{ bearerAuth: [] }],
        request: {
          query: z.object({
            prefix: z.optional(
              z.string()
                .min(1)
                .max(32)
                .openapi({
                  minLength: 1,
                  maxLength: 32,
                  description: 'The prefix to search for usernames',
                }),
            ),
            status: z.optional(
              z.enum(['ASSIGNED', 'RESERVED', 'FAILED'])
                .openapi({
                  description: 'Filter usernames by status',
                  examples: ['ASSIGNED'],
                }),
            ),
          }),
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(makeUsernameDTO()),
              },
            },
            description: 'List of usernames, optionally filtered by prefix',
          },
          400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
          429: {
            content: {
              'text/plain': {
                schema: z.unknown(),
              },
            },
            description: 'Rate Limit Exceeded',
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
      }),
      async (c) => {
        const { prefix, status } = c.req.valid('query')

        const handler = Effect.gen(function*() {
          const rows = yield* listUsernames({
            network: config.network,
            prefix,
            status,
            limit: MAX_USERNAMES_LIMIT,
          })

          const [corruptRows, items] = Array.separate(
            rows.map((row) => S.decodeUnknownEither(SelectIndividualityUsernameSchema)(row)),
          )

          if (corruptRows.length > 0) {
            yield* Effect.logWarning(
              `skipped ${corruptRows.length}/${rows.length} corrupt username row(s)`,
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
                  `${corruptRows.length} corrupt username row(s) out of ${rows.length} in list endpoint`,
                ),
              ),
            )
          }

          return items.map((item) => ({
            candidateAccountId: item.candidateAccountId,
            username: item.fullUsername ?? `${item.username}.${item.digits}`,
            status: item.status,
            onchainData: item.onchainData,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          }))
        }).pipe(
          Effect.withSpan('v1.list_usernames'),
        )

        const result = await bridgeSpanContext(handler, c).pipe(
          Effect.map((value) => c.json(value, 200)),
          withRouteTimeout,
          Effect.provideService(DB, db),
          Effect.exit,
          Runtime.runPromise(runtime),
        )

        if (Exit.isFailure(result)) {
          throw Cause.squash(result.cause)
        }

        return result.value
      },
    )
})

export const makeListUsernamesRoute = Effect.fn('v1.make_list_usernames_route')(() =>
  makeListUsernamesRouteWithoutDependencies.pipe(
    Effect.provide(Layer.unwrapEffect(Effect.gen(function*() {
      const { layerGetUsernamesV1Routes } = yield* Effect.promise(() => import('./layer.js'))

      return layerGetUsernamesV1Routes
    }))),
  )
)
