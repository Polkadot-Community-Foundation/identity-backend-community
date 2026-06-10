import type { Effect } from 'effect'
import * as S from 'effect/Schema'

export const Platform = S.Literal('ios', 'android')

export type Platform = S.Schema.Type<typeof Platform>

export const DeliveryPlatform = S.Literal('ios', 'android', 'web')
export type DeliveryPlatform = S.Schema.Type<typeof DeliveryPlatform>

export type NotificationCategory = 'chat' | 'gaming' | 'tattoo'

export const NotifyType = S.Literal('apns', 'voip', 'fcm', 'web')
export type NotifyType = S.Schema.Type<typeof NotifyType>

export const DeliveryChannel = S.Literal('apns', 'voip_apns', 'fcm', 'web_push')
export type DeliveryChannel = S.Schema.Type<typeof DeliveryChannel>

export const DeviceToken = S.String.pipe(S.minLength(1), S.maxLength(4096), S.brand('DeviceToken'))
export type DeviceToken = S.Schema.Type<typeof DeviceToken>

export const RedactedDeviceToken = S.RedactedFromSelf(DeviceToken)
export type RedactedDeviceToken = S.Schema.Type<typeof RedactedDeviceToken>

const PlatformTokensTypeId: unique symbol = Symbol.for('@push/PlatformTokens')
export type PlatformTokensTypeId = typeof PlatformTokensTypeId
export type IosTokensTypeId = PlatformTokensTypeId

export class IosTokens extends S.TaggedClass<IosTokens>()('IosTokens', {
  apns: S.NullOr(RedactedDeviceToken),
  voip: S.NullOr(RedactedDeviceToken),
}) {
  readonly [PlatformTokensTypeId] = PlatformTokensTypeId
}

export type AndroidTokensTypeId = PlatformTokensTypeId

export class AndroidTokens extends S.TaggedClass<AndroidTokens>()('AndroidTokens', {
  fcm: RedactedDeviceToken,
}) {
  readonly [PlatformTokensTypeId] = PlatformTokensTypeId
}

export type PlatformTokens = IosTokens | AndroidTokens

const TokenMissingTypeId: unique symbol = Symbol.for('@push/TokenMissing')
export type TokenMissingTypeId = typeof TokenMissingTypeId

export class ApnsTokenMissing extends S.TaggedError<ApnsTokenMissing>()('ApnsTokenMissing', {
  channel: S.Literal('apns'),
}) {
  readonly [TokenMissingTypeId] = TokenMissingTypeId
}

export class FcmTokenMissing extends S.TaggedError<FcmTokenMissing>()('FcmTokenMissing', {
  channel: S.Literal('fcm'),
}) {
  readonly [TokenMissingTypeId] = TokenMissingTypeId
}

export class VoipTokenMissing extends S.TaggedError<VoipTokenMissing>()('VoipTokenMissing', {
  channel: S.Literal('voip_apns'),
}) {
  readonly [TokenMissingTypeId] = TokenMissingTypeId
}

export type TokenMissing = ApnsTokenMissing | FcmTokenMissing | VoipTokenMissing

export class PushDeliveryFailed extends S.TaggedError<PushDeliveryFailed>()('PushDeliveryFailed', {
  deliveryChannel: DeliveryChannel,
  reason: S.String,
}) {
  override get message() {
    return `Push delivery failed via ${this.deliveryChannel}: ${this.reason}`
  }
}

const PushNotificationRequestTypeId: unique symbol = Symbol.for('@push/PushNotificationRequest')
export type PushNotificationRequestTypeId = typeof PushNotificationRequestTypeId
export type StatementPushRequestTypeId = PushNotificationRequestTypeId

export class StatementPushRequest extends S.TaggedClass<StatementPushRequest>()('StatementPushRequest', {
  deviceToken: RedactedDeviceToken,
  pushId: S.String,
  message: S.NullOr(S.String),
  topic: S.String,
  senderPubkey: S.String,
  truncated: S.Boolean,
  voip: S.optional(S.Boolean),
  topics: S.optional(S.Array(S.String)),
  expiry: S.optional(S.Number),
  notificationType: S.optional(NotifyType),
}) {
  readonly [PushNotificationRequestTypeId] = PushNotificationRequestTypeId
}

export type FlatPushRequestTypeId = PushNotificationRequestTypeId

export class FlatPushRequest extends S.TaggedClass<FlatPushRequest>()('FlatPushRequest', {
  deviceToken: RedactedDeviceToken,
  pushId: S.String,
  message: S.String,
  voip: S.optional(S.Boolean),
  topics: S.optional(S.Array(S.String)),
  expiry: S.optional(S.Number),
}) {
  readonly [PushNotificationRequestTypeId] = PushNotificationRequestTypeId
}

export type PushNotificationRequest = FlatPushRequest | StatementPushRequest

export interface PushNotificationResult {
  success: boolean
  platform: Platform
  sent?: number
  failed?: number
  messageId?: string
  errors?: {
    device: string
    environment?: 'development' | 'production'
    status?: string | number
    response?: unknown
  }[]
}

export namespace PushNotificationService {
  export interface Definition {
    send: (
      request: PushNotificationRequest,
    ) => Effect.Effect<
      PushNotificationResult,
      PushNotificationValidationError | PushNotificationServiceError | PushNotificationTokenInvalidError,
      never
    >
  }
}

const PushNotificationErrorTypeId: unique symbol = Symbol.for('@push/PushNotificationError')
export type PushNotificationErrorTypeId = typeof PushNotificationErrorTypeId

export class PushNotificationValidationError
  extends S.TaggedError<PushNotificationValidationError>()('PushNotificationValidationError', {
    message: S.String,
  })
{
  readonly [PushNotificationErrorTypeId] = PushNotificationErrorTypeId
}

export class PushNotificationServiceError
  extends S.TaggedError<PushNotificationServiceError>()('PushNotificationServiceError', {
    cause: S.optional(S.Unknown),
  })
{
  readonly [PushNotificationErrorTypeId] = PushNotificationErrorTypeId
}

export const TokenInvalidReason = S.Literal(
  'token_unregistered',
  'token_invalid',
)
export type TokenInvalidReason = S.Schema.Type<typeof TokenInvalidReason>

export class PushNotificationTokenInvalidError
  extends S.TaggedError<PushNotificationTokenInvalidError>()('PushNotificationTokenInvalidError', {
    platform: DeliveryPlatform,
    reason: TokenInvalidReason,
    providerCode: S.optional(S.String),
    cause: S.optional(S.Unknown),
  })
{
  readonly [PushNotificationErrorTypeId] = PushNotificationErrorTypeId
}
