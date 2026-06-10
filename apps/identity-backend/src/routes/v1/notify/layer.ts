import { APNService } from '#root/infrastructure/adapters/notifications/apn/index.js'
import { FCMPushService } from '#root/infrastructure/adapters/notifications/fcm/index.js'
import type { PushNotificationRequest } from '@identity-backend/mobile-push-notifications'
import { FlatPushRequest, RedactedDeviceToken } from '@identity-backend/mobile-push-notifications'
import { detectFromDeviceToken as detectPlatform } from '@identity-backend/mobile-push-notifications/platform'
import { Effect, Layer, Redacted, Schema as S } from 'effect'
import { NotifyV1RouteConfig } from './routes.js'

const PREFIX = 'notify_v1_route'

export const layerNotifyV1Routes = Layer.effect(
  NotifyV1RouteConfig,
  Effect.gen(function*() {
    const apnService = yield* APNService
    const fcmService = yield* FCMPushService

    const sendNotification = (Effect.fn(`${PREFIX}.send_notification`)(
      function*({ platform, body }) {
        yield* Effect.annotateCurrentSpan({ platform })

        const service = platform === 'ios' ? apnService : fcmService

        const { bundlerId, voip } = body
        const deviceToken = S.decodeSync(RedactedDeviceToken)(Redacted.make(body.deviceToken))
        const pushRequest: PushNotificationRequest = new FlatPushRequest({
          deviceToken,
          pushId: body.pushId,
          message: body.message,
          ...(bundlerId && { topics: [bundlerId] }),
          ...(voip !== undefined && { voip }),
        })

        const pushResult = yield* service.send(pushRequest)

        yield* Effect.annotateCurrentSpan({ success: pushResult.success })
        yield* Effect.logDebug('Push notification result', {
          platform,
          success: pushResult.success,
          sent: pushResult.sent,
          failed: pushResult.failed,
          ...(pushResult.errors && { errors: pushResult.errors }),
        })

        return pushResult
      },
    )) satisfies NotifyV1RouteConfig['Type']['sendNotification']

    return {
      detectPlatform,
      sendNotification,
    } satisfies NotifyV1RouteConfig['Type'] as NotifyV1RouteConfig['Type']
  }),
)
