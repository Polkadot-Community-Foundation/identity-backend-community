import { USERNAME_V1_REGEXP } from '#root/constants.js'
import { DB } from '#root/db/drizzle.js'
import { SelectIndividualityUsernameSchema } from '#root/db/individuality.adapter.js'
import { createOpenAPIHono, ProblemDetailWithErrorsZod, problemResponse } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { bridgeSpanContext } from '#root/tracing/bridge-span-context.js'
import type { HttpBindings } from '@hono/node-server'
import { createRoute, z } from '@hono/zod-openapi'
import type { SpanContext } from '@opentelemetry/api'
import { Cause, Effect, Exit, Layer, Runtime, Schema as S } from 'effect'
import { GetUsernamesV1RouteConfig, makeUsernameDTO } from './types.js'

export const makeGetUsernameRouteWithoutDependencies = Effect.gen(function*() {
  const {
    getNetwork,
  } = yield* GetUsernamesV1RouteConfig
  const db = yield* DB
  const runtime = yield* Effect.runtime()

  const config = {
    network: yield* getNetwork(),
  }

  return createOpenAPIHono<{
    Bindings: HttpBindings
    Variables: {
      spanContext?: SpanContext
    }
  }>()
    .openapi(
      createRoute({
        summary: 'Get Username',
        method: 'get',
        path: '/:username',
        tags: ['v1'],
        security: [{ bearerAuth: [] }],
        request: {
          params: z.object({
            username: z.string()
              .regex(USERNAME_V1_REGEXP)
              .openapi({
                description: `The full username to fetch.`,
                examples: ['alice.11'],
              })
              .transform((username) => {
                const [, base, digits] = username.match(USERNAME_V1_REGEXP)!
                return { base: base!, digits: digits! }
              }),
          }),
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: makeUsernameDTO(USERNAME_V1_REGEXP),
              },
            },
            description: 'Ok',
          },
          400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
          404: {
            content: {
              'application/json': {
                schema: z.object({
                  error: z.string(),
                }),
              },
            },
            description: 'Not Found',
          },
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
        const params = c.req.valid('param')

        const handler = Effect.gen(function*() {
          const row = yield* Effect.tryPromise({
            try: () =>
              db.query.individualityUsernames
                .findFirst({
                  where: {
                    username: { eq: params.username.base },
                    digits: { eq: params.username.digits },
                    network: { eq: config.network },
                  },
                }),
            catch: (error) => error,
          })

          if (!row) {
            return c.json({ error: 'Username not found' }, 404)
          }

          const username = yield* S.decodeUnknown(SelectIndividualityUsernameSchema)(row)

          return c.json({
            candidateAccountId: username.candidateAccountId,
            username: `${username.username}.${username.digits}`,
            status: username.status,
            onchainData: username.onchainData,
            createdAt: username.createdAt,
            updatedAt: username.updatedAt,
          }, 200)
        }).pipe(
          Effect.withSpan('v1.get_username'),
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
      },
    )
})

export const makeGetUsernameRoute = Effect.fn('v1.make_get_username_route')(() =>
  makeGetUsernameRouteWithoutDependencies.pipe(
    Effect.provide(Layer.unwrapEffect(Effect.gen(function*() {
      const { layerGetUsernamesV1Routes } = yield* Effect.promise(() => import('./layer.js'))

      return layerGetUsernamesV1Routes
    }))),
  )
)
