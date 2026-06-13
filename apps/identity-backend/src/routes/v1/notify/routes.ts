import { createOpenAPIHono, ProblemDetailWithErrorsZod, problemResponse } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { createRoute, z } from '@hono/zod-openapi'
import type { Platform, PushNotificationResult } from '@identity-backend/mobile-push-notifications'
import { detectFromDeviceToken as detectPlatform } from '@identity-backend/mobile-push-notifications/platform'
import { bridgeSpanContext } from '@identity-backend/observability'
import { Cause, Context, Effect, Exit, Layer, pipe, Runtime } from 'effect'
import { cors } from 'hono/cors'
import { PushSendRequest, PushSendResponse } from './types.js'

type PushSendRequestType = z.infer<typeof PushSendRequest>

export namespace NotifyV1RouteConfig {
  export interface SendNotificationParams {
    deviceToken: string
    platform: Platform
    body: PushSendRequestType
  }
}

export class NotifyV1RouteConfig
  extends Context.Tag('push-relayer-container/routes/v1/notify/router/NotifyV1RouteConfig')<
    NotifyV1RouteConfig,
    {
      detectPlatform: typeof detectPlatform
      sendNotification: (
        params: NotifyV1RouteConfig.SendNotificationParams,
      ) => Effect.Effect<PushNotificationResult, Error>
    }
  >()
{}

export const makeNotifyRouteWithoutDependencies = Effect.gen(function*() {
  const { detectPlatform, sendNotification } = yield* NotifyV1RouteConfig
  const runtime = yield* Effect.runtime()

  const notifyRoute = createOpenAPIHono()
    .openapi(
      createRoute({
        summary: 'Send Push Notification',
        description: 'Send a push notification to iOS (APN) or Android (FCM) device.',
        method: 'post',
        path: '/',
        tags: ['v1'],
        security: [{ bearerAuth: [] }],
        request: {
          body: {
            required: true,
            content: {
              'application/json': {
                schema: PushSendRequest,
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: PushSendResponse,
              },
            },
            description: 'Success',
          },
          400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
          401: {
            content: {
              'application/json': {
                schema: z.object({
                  error: z.string(),
                }),
              },
            },
            description: 'Unauthorized',
          },
        },
      }),
      async (c) => {
        const body = c.req.valid('json') as PushSendRequestType

        const handler = Effect.gen(function*() {
          const platform = detectPlatform(body.deviceToken, body.platform)
          return yield* sendNotification({
            deviceToken: body.deviceToken,
            platform,
            body: {
              ...body,
              platform,
            },
          })
        }).pipe(
          Effect.withSpan('send_notification'),
          Effect.catchAll((error) =>
            Effect.succeed({
              success: false,
              platform: body.platform || 'android' as const,
              errors: [{
                device: body.deviceToken,
                response: error instanceof Error ? error.message : 'Notification failed',
              }],
            })
          ),
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

  return yield* pipe(
    Effect.succeed(createOpenAPIHono()),
    Effect.tap((app) => app.use(cors())),
    Effect.map((app) => app.route('/', notifyRoute)),
  )
})

export const makeNotifyRoute = Effect.fn('v1.make_notify_route')(() =>
  makeNotifyRouteWithoutDependencies.pipe(
    Effect.provide(Layer.unwrapEffect(Effect.gen(function*() {
      const { layerNotifyV1Routes } = yield* Effect.promise(() => import('./layer.js'))

      return layerNotifyV1Routes
    }))),
  )
)
