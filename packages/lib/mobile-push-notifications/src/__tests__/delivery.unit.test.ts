import { describe, expect, it } from '@effect/vitest'
import { MAX_PAYLOAD_SIZE_APNS, MAX_PAYLOAD_SIZE_FCM, MAX_PAYLOAD_SIZE_VOIP } from '../delivery.constants.js'
import { fitPayloadData, getMaxPayloadSize, isPayloadTruncated, selectChannel } from '../delivery.js'
describe('Push Notification Delivery', () => {
  describe('selectChannel', () => {
    it('Should_ReturnApns_When_Apns', () => {
      expect(selectChannel('apns')).toBe('apns')
    })

    it('Should_ReturnVoipApns_When_Voip', () => {
      expect(selectChannel('voip')).toBe('voip_apns')
    })

    it('Should_ReturnFcm_When_Fcm', () => {
      expect(selectChannel('fcm')).toBe('fcm')
    })

    it('Should_ReturnWebPush_When_Web', () => {
      expect(selectChannel('web')).toBe('web_push')
    })
  })

  describe('getMaxPayloadSize', () => {
    it('Should_ReturnApnsSize_When_Apns', () => {
      expect(getMaxPayloadSize('apns')).toBe(MAX_PAYLOAD_SIZE_APNS)
    })

    it('Should_ReturnVoipSize_When_Voip', () => {
      expect(getMaxPayloadSize('voip')).toBe(MAX_PAYLOAD_SIZE_VOIP)
    })

    it('Should_ReturnFcmSize_When_Fcm', () => {
      expect(getMaxPayloadSize('fcm')).toBe(MAX_PAYLOAD_SIZE_FCM)
    })

    it('Should_ReturnFcmSize_When_Web', () => {
      expect(getMaxPayloadSize('web')).toBe(MAX_PAYLOAD_SIZE_FCM)
    })
  })

  describe('isPayloadTruncated', () => {
    it('Should_ReturnFalse_When_PayloadEqualsMaxSize', () => {
      const payload = 'x'.repeat(MAX_PAYLOAD_SIZE_APNS)
      expect(isPayloadTruncated(payload, { notifyType: 'apns' })).toBe(false)
    })

    it('Should_ReturnTrue_When_PayloadExceedsMaxSize', () => {
      const payload = 'x'.repeat(MAX_PAYLOAD_SIZE_APNS + 1)
      expect(isPayloadTruncated(payload, { notifyType: 'apns' })).toBe(true)
    })

    it('Should_ReturnFalse_When_PayloadBelowMaxSize', () => {
      const payload = 'x'.repeat(MAX_PAYLOAD_SIZE_APNS - 1)
      expect(isPayloadTruncated(payload, { notifyType: 'apns' })).toBe(false)
    })
  })

  describe('fitPayloadData', () => {
    it('Should_ReturnNullData_When_PayloadExceedsMaxSize', () => {
      const payload = 'x'.repeat(MAX_PAYLOAD_SIZE_APNS + 1)
      const result = fitPayloadData(payload, { notifyType: 'apns' })
      expect(result.data).toBeNull()
      expect(result.truncated).toBe(true)
    })

    it('Should_ReturnOriginalPayload_When_PayloadWithinLimit', () => {
      const payload = 'x'.repeat(MAX_PAYLOAD_SIZE_APNS)
      const result = fitPayloadData(payload, { notifyType: 'apns' })
      expect(result.data).toBe(payload)
      expect(result.truncated).toBe(false)
    })

    it('Should_ReturnNullData_When_PayloadExceedsMaxSizeForVoip', () => {
      const payload = 'x'.repeat(MAX_PAYLOAD_SIZE_VOIP + 1)
      const result = fitPayloadData(payload, { notifyType: 'voip' })
      expect(result.data).toBeNull()
      expect(result.truncated).toBe(true)
    })

    it('Should_ReturnNullData_When_PayloadExceedsMaxSizeForFcm', () => {
      const payload = 'x'.repeat(MAX_PAYLOAD_SIZE_FCM + 1)
      const result = fitPayloadData(payload, { notifyType: 'fcm' })
      expect(result.data).toBeNull()
      expect(result.truncated).toBe(true)
    })
  })
})
