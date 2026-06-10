import type { IndividualityUsernameService } from '#root/features/individuality/services/username-availability.service.js'
import { createOpenAPIHono, ProblemDetailWithErrorsZod, problemResponse } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { BaseUsername } from '#root/schema/username.js'
import { bridgeSpanContext } from '#root/tracing/bridge-span-context.js'
import { createRoute, z } from '@hono/zod-openapi'
import {
  Array,
  Cause,
  Context,
  Effect,
  Either,
  Exit,
  HashMap,
  HashSet,
  Layer,
  Match,
  pipe,
  Runtime,
  Schema as S,
} from 'effect'
import { computeAvailableDigits } from './compute-available-digits.js'
import {
  CheckUsernameAvailabilityResponse,
  CheckUsernameAvailabilityV0Response,
  CheckUsernameAvailabilityV1Request,
  CheckUsernameAvailabilityV1Response,
  CheckUsernameAvailabilityVersionQuery,
} from './types.js'

export class CheckAvailabilityRouteConfig
  extends Context.Tag('CheckAvailabilityRouteConfig')<CheckAvailabilityRouteConfig, {
    checkUsernamesAvailability: IndividualityUsernameService['checkAvailability']
    getMaximumUsernameAllocation: () => number
  }>()
{}

export const makeCheckAvailabilityRouteWithoutDependencies = () =>
  Effect.gen(function*() {
    const runtime = yield* Effect.runtime()
    const {
      checkUsernamesAvailability,
      getMaximumUsernameAllocation,
    } = yield* CheckAvailabilityRouteConfig

    return createOpenAPIHono<{}>()
      .openapi(
        createRoute({
          summary: 'Check username availability',
          description:
            'Returns availability status (`AVAILABLE`, `EXHAUSTED`, `INVALID`) for each username. Use `?version=v1` to also get registerable digit suffixes.',
          method: 'post',
          tags: ['v1'],
          security: [{ bearerAuth: [] }],
          path: '/',
          request: {
            query: CheckUsernameAvailabilityVersionQuery,
            body: {
              content: {
                'application/json': {
                  schema: CheckUsernameAvailabilityV1Request,
                },
              },
            },
          },
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: CheckUsernameAvailabilityResponse,
                },
              },
              description: 'Availability status for each requested username.',
            },
            400: {
              ...problemResponse(ProblemDetailWithErrorsZod),
              description: 'Validation failed — see response body for details.',
            },
            429: {
              content: {
                'text/plain': {
                  schema: z.unknown(),
                },
              },
              description: 'Rate limit exceeded — retry after the `Retry-After` period.',
            },
            500: {
              content: {
                'application/json': {
                  schema: z.object({
                    error: z.string(),
                  }),
                },
              },
              description: 'People chain lookup failed — safe to retry with backoff.',
            },
          },
        }),
        async (c) => {
          const { usernames } = c.req.valid('json')
          const { version } = c.req.valid('query')

          const handler = Effect.gen(function*() {
            const MAXIMUM_USERNAME_ALLOCATION = getMaximumUsernameAllocation()

            const [invalidUsernames, validUsernames] = yield* pipe(
              Array.map(usernames, (username) =>
                S.decodeEither(BaseUsername)(username).pipe(Either.mapLeft(() => username))),
              Effect.succeed,
              Effect.andThen(Array.partition(Either.isRight)),
            )

            const [exhaustedUsernames, availableUsernames] = yield* checkUsernamesAvailability({
              usernames: HashSet.make(...Array.map(validUsernames, Either.getOrThrow)),
            }).pipe(
              Effect.map(HashMap.toEntries),
              Effect.map(Array.partition(([_, allocatedDigits]) =>
                HashSet.size(allocatedDigits) < MAXIMUM_USERNAME_ALLOCATION
              )),
            )

            return pipe(
              Match.value(version),
              Match.when('v1', () => {
                const v1Value = Object.fromEntries([
                  ...invalidUsernames.map((either) => [
                    either.left,
                    { status: 'INVALID' as const },
                  ]),
                  ...availableUsernames.map(([username, allocatedDigits]) => [
                    username,
                    { status: 'AVAILABLE' as const, availableDigits: computeAvailableDigits(allocatedDigits) },
                  ]),
                  ...exhaustedUsernames.map(([username]) => [
                    username,
                    { status: 'EXHAUSTED' as const },
                  ]),
                ])

                return { _tag: 'v1' as const, value: v1Value } satisfies CheckUsernameAvailabilityV1Response
              }),
              Match.when('v0', () =>
                Object.fromEntries([
                  ...invalidUsernames.map((either) => [
                    either.left,
                    'INVALID' as const,
                  ]),
                  ...availableUsernames.map(([username]) => [
                    username,
                    'AVAILABLE' as const,
                  ]),
                  ...exhaustedUsernames.map(([username]) => [
                    username,
                    'EXHAUSTED' as const,
                  ]),
                ]) satisfies CheckUsernameAvailabilityV0Response),
              Match.exhaustive,
            )
          }).pipe(
            Effect.withSpan('check_username_availability'),
          )

          const result = await bridgeSpanContext(handler, c).pipe(
            Effect.map((value) =>
              c.json(value, 200)
            ),
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

export const makeCheckAvailabilityRoute = () =>
  makeCheckAvailabilityRouteWithoutDependencies().pipe(
    Effect.provide(Layer.unwrapEffect(Effect.gen(function*() {
      const { layerCheckAvailabilityRoutes } = yield* Effect.promise(() => import('./layer.js'))

      return layerCheckAvailabilityRoutes
    }))),
  )
