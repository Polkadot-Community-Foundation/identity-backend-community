import { Function, Match } from 'effect'
import { MAX_PAYLOAD_SIZE_APNS, MAX_PAYLOAD_SIZE_FCM, MAX_PAYLOAD_SIZE_VOIP } from './delivery.constants.js'
import type { DeliveryChannel, NotifyType } from './types.js'

export const selectChannel = (notifyType: NotifyType): DeliveryChannel =>
  Match.value(notifyType).pipe(
    Match.when('apns', () => 'apns' as const),
    Match.when('voip', () => 'voip_apns' as const),
    Match.when('fcm', () => 'fcm' as const),
    Match.when('web', () => 'web_push' as const),
    Match.exhaustive,
  )

export const getMaxPayloadSize = (notifyType: NotifyType): number =>
  Match.value(notifyType).pipe(
    Match.when('apns', () => MAX_PAYLOAD_SIZE_APNS),
    Match.when('voip', () => MAX_PAYLOAD_SIZE_VOIP),
    Match.when('fcm', () => MAX_PAYLOAD_SIZE_FCM),
    Match.when('web', () => MAX_PAYLOAD_SIZE_FCM),
    Match.exhaustive,
  )

export const isPayloadTruncated = Function.dual<
  (options: { readonly notifyType: NotifyType }) => (self: string) => boolean,
  (self: string, options: { readonly notifyType: NotifyType }) => boolean
>(2, (encodedPayload, { notifyType }) => {
  const maxPayloadBytes = getMaxPayloadSize(notifyType)
  const payloadBytes = new TextEncoder().encode(encodedPayload).length
  return payloadBytes > maxPayloadBytes
})

export interface FitPayloadResult {
  readonly data: string | null
  readonly truncated: boolean
}

export const fitPayloadData = Function.dual<
  (options: { readonly notifyType: NotifyType }) => (self: string) => FitPayloadResult,
  (self: string, options: { readonly notifyType: NotifyType }) => FitPayloadResult
>(2, (encodedPayload, options) =>
  isPayloadTruncated(encodedPayload, options)
    ? { data: null, truncated: true }
    : { data: encodedPayload, truncated: false })
