import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { createRoute, z } from '@hono/zod-openapi'
import type { SpanContext } from '@opentelemetry/api'
import { toHex } from '@polkadot-api/utils'
import { Cause, Effect, Exit, pipe, Runtime } from 'effect'
import { etag } from 'hono/etag'

import { bridgeSpanContext } from '@identity-backend/observability'

const makeAttesterRouteWithoutDependencies = Effect.gen(function*() {
  const runtime = yield* Effect.runtime()
  const { ATTESTER_PUBLIC_KEY } = yield* Effect.promise(() => import('#root/config.js'))
  const attesterPublicKey = yield* ATTESTER_PUBLIC_KEY

  return createOpenAPIHono<{
    Variables: {
      spanContext?: SpanContext
    }
  }>()
    .openapi(
      createRoute({
        summary: 'Get Attester',
        description: 'Returns the public key of the attester.',
        method: 'get',
        path: '/',
        tags: ['v1'],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.object({
                  attester: z.string(),
                }),
              },
            },
            description: 'Success',
          },
        },
      }),
      async (c) => {
        const handler = Effect.sync(() => {
          return {
            attester: toHex(attesterPublicKey),
          }
        }).pipe(
          Effect.withSpan('v1.get_attester'),
        )

        const result = await bridgeSpanContext(handler, c).pipe(
          Effect.map((value) => c.json(value, 200)),
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

export const makeAttesterRoute = Effect.fn('v1.make_attester_route')(() =>
  pipe(
    makeAttesterRouteWithoutDependencies,
    Effect.andThen((attesterRoute) =>
      pipe(
        Effect.succeed(createOpenAPIHono()),
        Effect.tap((app) => app.use(etag({ weak: false }))),
        Effect.map((app) => app.route('/', attesterRoute)),
      )
    ),
  )
)
