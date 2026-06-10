import * as S from 'effect/Schema'
import { type PushNotificationResult } from '../types.js'
import { DEVICE_TOKEN_MAX_LENGTH, DEVICE_TOKEN_MIN_LENGTH } from './constants.js'

export const APNTopic = S.String.pipe(
  S.pattern(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/),
  S.brand('APNTopic'),
)
export type APNTopic = S.Schema.Type<typeof APNTopic>

export const APNEnvironment = S.Literal('development', 'production')
export type APNEnvironment = S.Schema.Type<typeof APNEnvironment>

export interface APNSendTarget {
  topic: APNTopic
  environment: APNEnvironment
}

export const ValidDeviceToken = S.Redacted(
  S.String.pipe(
    S.minLength(DEVICE_TOKEN_MIN_LENGTH),
    S.maxLength(DEVICE_TOKEN_MAX_LENGTH),
  ),
).pipe(S.brand('ValidDeviceToken'))
export type ValidDeviceToken = S.Schema.Type<typeof ValidDeviceToken>

export const APNSentResult = S.Struct({
  device: S.String,
  'apns-unique-id': S.optional(S.String),
  'apns-id': S.optional(S.String),
  'apns-request-id': S.optional(S.String),
  'apns-channel-id': S.optional(S.String),
})
export type APNSentResult = S.Schema.Type<typeof APNSentResult>

export const APNFailedResult = S.Struct({
  device: S.String,
  status: S.optional(S.Number),
  response: S.optional(S.Struct({
    reason: S.optional(S.String),
    timestamp: S.optional(S.String),
  })),
  'apns-unique-id': S.optional(S.String),
  'apns-id': S.optional(S.String),
  'apns-request-id': S.optional(S.String),
  'apns-channel-id': S.optional(S.String),
})
export type APNFailedResult = S.Schema.Type<typeof APNFailedResult>

export const APNProviderResult = S.Struct({
  sent: S.Array(APNSentResult),
  failed: S.Array(APNFailedResult),
})
export type APNProviderResult = S.Schema.Type<typeof APNProviderResult>

export const APNTargetResult = S.Struct({
  environment: APNEnvironment,
  topic: APNTopic,
  result: APNProviderResult,
})
export type APNTargetResult = S.Schema.Type<typeof APNTargetResult>

export type PushResult = PushNotificationResult
export type PushError = NonNullable<PushResult['errors']>[number]
