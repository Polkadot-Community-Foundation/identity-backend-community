import { describe, expect, it } from 'vitest'
import { detectFromDeviceToken } from './platform.js'

describe('detectPlatformFromDeviceToken', () => {
  describe('platform hint precedence', () => {
    it('Should_ReturnIOS_When_IosHintProvided', () => {
      const fcmToken = 'f991KszkPdZEwIblAIh1bx:APA91bH'
      expect(detectFromDeviceToken(fcmToken, 'ios')).toBe('ios')
    })

    it('Should_ReturnAndroid_When_AndroidHintProvided', () => {
      const iosToken = 'a'.repeat(64)
      expect(detectFromDeviceToken(iosToken, 'android')).toBe('android')
    })
  })

  describe('boundary lengths', () => {
    it('Should_DetectAndroid_When_Token31Chars', () => {
      expect(detectFromDeviceToken('a'.repeat(31))).toBe('android')
    })

    it('Should_DetectIOS_When_Token32Chars', () => {
      expect(detectFromDeviceToken('a'.repeat(32))).toBe('ios')
    })

    it('Should_DetectIOS_When_Token128Chars', () => {
      expect(detectFromDeviceToken('a'.repeat(128))).toBe('ios')
    })

    it('Should_DetectAndroid_When_Token129Chars', () => {
      expect(detectFromDeviceToken('a'.repeat(129))).toBe('android')
    })
  })

  describe('non-hex characters indicate Android', () => {
    it('Should_DetectAndroid_When_TokenContainsColon', () => {
      expect(detectFromDeviceToken('aa:bb')).toBe('android')
    })

    it('Should_DetectAndroid_When_TokenContainsUnderscore', () => {
      expect(detectFromDeviceToken('aa_bb')).toBe('android')
    })

    it('Should_DetectAndroid_When_TokenContainsHyphen', () => {
      expect(detectFromDeviceToken('aa-bb')).toBe('android')
    })
  })
})
