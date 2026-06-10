import { describe, it } from '@effect/vitest'
import * as fc from 'fast-check'
import { MAX_PAYLOAD_SIZE_APNS, MAX_PAYLOAD_SIZE_VOIP } from '../delivery.constants.js'
import { fitPayloadData, getMaxPayloadSize, isPayloadTruncated, selectChannel } from '../delivery.js'
import type { NotifyType } from '../types.js'

describe('Push Notification Delivery', () => {
  const NotifyTypeArb: fc.Arbitrary<NotifyType> = fc.constantFrom('apns', 'voip', 'fcm', 'web')

  const PayloadSizeArb = fc.integer({ min: 0, max: 10000 })

  it.prop(
    '∀x_Delivery_=Deterministic',
    [NotifyTypeArb],
    ([notifyType]: [NotifyType]) => {
      const channel1 = selectChannel(notifyType)
      const channel2 = selectChannel(notifyType)
      const size1 = getMaxPayloadSize(notifyType)
      const size2 = getMaxPayloadSize(notifyType)

      return channel1 === channel2 && size1 === size2
    },
  )

  it.prop(
    '∀p_Truncated_⊇Size',
    [NotifyTypeArb, PayloadSizeArb],
    ([notifyType, payloadSize]: [NotifyType, number]) => {
      const maxSize = getMaxPayloadSize(notifyType)
      const payload = 'x'.repeat(payloadSize)
      const actualBytes = new TextEncoder().encode(payload).length
      const truncated = isPayloadTruncated(payload, { notifyType })

      return truncated === (actualBytes > maxSize)
    },
  )

  it.prop(
    '→>Max_Payload_→Null∧Truncated',
    [NotifyTypeArb, fc.integer({ min: 0, max: MAX_PAYLOAD_SIZE_VOIP })],
    ([notifyType, extraBytes]: [NotifyType, number]) => {
      const maxSize = getMaxPayloadSize(notifyType)
      const payload = 'x'.repeat(maxSize + 1 + extraBytes)
      const result = fitPayloadData(payload, { notifyType })
      return result.data === null && result.truncated === true
    },
  )

  it.prop(
    '→<Max_Payload_=Original∧¬Truncated',
    [NotifyTypeArb, fc.integer({ min: 0, max: MAX_PAYLOAD_SIZE_APNS - 1 })],
    ([notifyType, payloadSize]: [NotifyType, number]) => {
      const payload = 'x'.repeat(payloadSize)
      const result = fitPayloadData(payload, { notifyType })
      return result.data === payload && result.truncated === false
    },
  )

  it.prop(
    '→=Max_Payload_¬Truncated',
    [NotifyTypeArb],
    ([notifyType]: [NotifyType]) => {
      const maxSize = getMaxPayloadSize(notifyType)
      const payload = 'x'.repeat(maxSize)
      const result = fitPayloadData(payload, { notifyType })
      return result.truncated === false && result.data === payload
    },
  )

  it.prop(
    '→≥Max_Payload_→Truncated',
    [NotifyTypeArb],
    ([notifyType]: [NotifyType]) => {
      const maxSize = getMaxPayloadSize(notifyType)
      const payload = 'x'.repeat(maxSize + 1)
      const result = fitPayloadData(payload, { notifyType })
      return result.truncated === true && result.data === null
    },
  )
})
