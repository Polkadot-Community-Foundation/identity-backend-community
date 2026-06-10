import { GOOGLE_CREDENTIALS } from '#root/config.js'
import type {
  PushNotificationRequest,
  PushNotificationResult,
  PushNotificationService,
  TokenInvalidReason,
} from '@identity-backend/mobile-push-notifications'
import {
  FlatFcmPayload,
  PushNotificationServiceError,
  PushNotificationTokenInvalidError,
  PushNotificationValidationError,
  StatementFcmPayloadWire,
} from '@identity-backend/mobile-push-notifications'
import type { JWTInput } from '@identity-backend/play-integrity'
import { Context, Effect, Layer, Match, Redacted, Schema as S } from 'effect'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getMessaging, type Messaging } from 'firebase-admin/messaging'

const FCM_TOKEN_INVALID_CODES: Readonly<Record<string, TokenInvalidReason>> = {
  'messaging/registration-token-not-registered': 'token_unregistered',
  'messaging/invalid-registration-token': 'token_invalid',
  'messaging/invalid-recipient': 'token_invalid',
}

const isObjectWithStringCode = (value: unknown): value is { readonly code: string } =>
  typeof value === 'object' && value !== null && 'code' in value &&
  typeof (value as { code: unknown }).code === 'string'

export const classifyFcmError = (
  cause: unknown,
): PushNotificationTokenInvalidError | PushNotificationServiceError => {
  if (isObjectWithStringCode(cause)) {
    const reason = FCM_TOKEN_INVALID_CODES[cause.code]
    if (reason !== undefined) {
      return PushNotificationTokenInvalidError.make({
        platform: 'android',
        reason,
        providerCode: cause.code,
        cause,
      })
    }
  }
  return PushNotificationServiceError.make({ cause })
}

export namespace FCMPushService {
  export interface Service {
    readonly send: PushNotificationService.Definition['send']
  }
}

type Service = FCMPushService.Service

export class FCMPushServiceConfig extends Context.Tag('FCMPushServiceConfig')<FCMPushServiceConfig, {
  serviceAccount: Redacted.Redacted<JWTInput>
}>() {}

export class FCMPushService extends Effect.Service<FCMPushService>()('FCMPushService', {
  effect: Effect.gen(function*() {
    const config = yield* FCMPushServiceConfig

    const firebaseApp = yield* Effect.sync(() =>
      getApps()[0] ?? initializeApp({
        // oxlint-disable-next-line typescript/no-explicit-any
        credential: cert(Redacted.value(config.serviceAccount) as any),
      })
    )

    const messaging: Messaging = getMessaging(firebaseApp)
    const encodeFcmWire = S.encodeSync(StatementFcmPayloadWire)

    const send = Effect.fn('send')((request: PushNotificationRequest) =>
      Effect.gen(function*() {
        const token = Redacted.value(request.deviceToken)
        if (!token) {
          yield* Effect.fail(
            PushNotificationValidationError.make({
              message: 'deviceToken is required',
            }),
          )
        }

        const data = Match.value(request).pipe(
          Match.tag('StatementPushRequest', (r) =>
            encodeFcmWire({
              statementData: r.message ?? '',
              statementTopic: r.topic,
              senderPubkey: r.senderPubkey,
              notifyType: r.notificationType ?? 'fcm',
            })),
          Match.tag('FlatPushRequest', (r) => {
            const { _tag, ...rest } = new FlatFcmPayload({
              pushType: 'chat',
              pushId: r.pushId,
              message: r.message,
            })
            return rest
          }),
          Match.exhaustive,
        )

        const isVoip = Match.value(request).pipe(
          Match.tag('StatementPushRequest', (r) => r.notificationType === 'voip'),
          Match.tag('FlatPushRequest', () => false),
          Match.exhaustive,
        )

        const message = {
          token,
          data,
          android: {
            priority: 'high' as const,
            ...(isVoip ? { ttl: 60 } : {}),
          },
        }

        const messageId = yield* Effect.tryPromise({
          try: () => messaging.send(message),
          catch: classifyFcmError,
        })

        const result: PushNotificationResult = {
          success: true,
          platform: 'android',
          messageId,
          sent: 1,
        }

        return result
      })
    ) satisfies Service['send']

    return {
      send,
    } satisfies Service
  }).pipe(Effect.scoped),
  dependencies: [
    Layer.effect(
      FCMPushServiceConfig,
      Effect.gen(function*() {
        return {
          serviceAccount: yield* GOOGLE_CREDENTIALS,
        }
      }),
    ),
  ],
}) {}
