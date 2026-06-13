import { ICE_SERVERS } from '#root/config'
import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { IssueTurnCredentialsUseCase } from '#root/webrtc/issue-turn-credentials.use-case.js'
import { createRoute, z } from '@hono/zod-openapi'
import { bridgeSpanContext } from '@identity-backend/observability'
import type { SpanContext } from '@opentelemetry/api'
import { Cause, Duration, Effect, Exit, Redacted, Runtime } from 'effect'
import { encodeBase64 } from 'effect/Encoding'

export const makeTurnIssueRoute = Effect.gen(function*() {
  const iceServers = yield* ICE_SERVERS
  const runtime = yield* Effect.runtime()
  const issueTurnCredentials = yield* IssueTurnCredentialsUseCase

  const TurnIssueRequestZod = z.object({
    regionHint: z.string().optional().nullable().describe('Optional region hint (reserved for future use)'),
  })

  const TurnIssueResponseZod = z.object({
    servers: z.array(z.string()).describe('Array of ICE server URLs'),
    username: z.string().describe('TURN username in format: {timestamp}:{hex-id}'),
    password: z.string().describe('HMAC-generated TURN password (base64)'),
    ttl: z.number().int().positive().describe('Credential time-to-live in seconds'),
  })

  return createOpenAPIHono<{
    Variables: {
      spanContext?: SpanContext
    }
  }>()
    .openapi(
      createRoute({
        summary: 'Issue TURN Credentials',
        description: 'Generates short-lived TURN credentials for WebRTC ICE negotiation.',
        method: 'post',
        path: '/issue',
        tags: ['v1'],
        request: {
          body: {
            required: true,
            content: {
              'application/json': {
                schema: TurnIssueRequestZod,
              },
            },
          },
        },
        responses: {
          201: {
            content: {
              'application/json': {
                schema: TurnIssueResponseZod,
              },
            },
            description: 'TURN credentials issued successfully',
          },
        },
      }),
      async (c) => {
        const body = c.req.valid('json')
        const regionHint = body?.regionHint ?? undefined

        const handler = Effect.gen(function*() {
          const credentials = yield* issueTurnCredentials(regionHint)

          return TurnIssueResponseZod.encode({
            servers: iceServers.map((url) => url.toString()),
            username: credentials.username.toString(),
            password: encodeBase64(Redacted.value(credentials.password)),
            ttl: Duration.toSeconds(credentials.ttl),
          })
        }).pipe(
          Effect.withSpan('v1.turn_issue', {
            attributes: { 'region.hint': regionHint },
          }),
        )

        const result = await bridgeSpanContext(handler, c).pipe(
          Effect.map((response) => c.json(response, 201)),
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
