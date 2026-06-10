import { describe, expect, it } from 'vitest'
import { classifyFcmError } from './service.js'

describe('classifyFcmError', () => {
  it.each(
    [
      ['messaging/registration-token-not-registered', 'token_unregistered'],
      ['messaging/invalid-registration-token', 'token_invalid'],
      ['messaging/invalid-recipient', 'token_invalid'],
    ] as const,
  )('Should_ClassifyAsTerminalToken_When_FirebaseCodeIs_%s', (code, expectedReason) => {
    const cause = Object.assign(new Error('boom'), { code })
    const result = classifyFcmError(cause)

    expect(result._tag).toBe('PushNotificationTokenInvalidError')
    if (result._tag !== 'PushNotificationTokenInvalidError') return
    expect(result.platform).toBe('android')
    expect(result.reason).toBe(expectedReason)
    expect(result.providerCode).toBe(code)
    expect(result.cause).toBe(cause)
  })

  it.each([
    'messaging/server-unavailable',
    'messaging/internal-error',
    'messaging/unknown-error',
    'messaging/quota-exceeded',
    'messaging/mismatched-credential',
  ])('Should_ClassifyAsTransientService_When_FirebaseCodeIs_%s', (code) => {
    const cause = Object.assign(new Error('transient'), { code })
    const result = classifyFcmError(cause)

    expect(result._tag).toBe('PushNotificationServiceError')
    if (result._tag !== 'PushNotificationServiceError') return
    expect(result.cause).toBe(cause)
  })

  it('Should_ClassifyAsTransientService_When_CauseHasNoCode', () => {
    const cause = new Error('opaque')
    const result = classifyFcmError(cause)
    expect(result._tag).toBe('PushNotificationServiceError')
  })

  it('Should_ClassifyAsTransientService_When_CauseIsNotObject', () => {
    expect(classifyFcmError('string-error')._tag).toBe('PushNotificationServiceError')
    expect(classifyFcmError(undefined)._tag).toBe('PushNotificationServiceError')
    expect(classifyFcmError(null)._tag).toBe('PushNotificationServiceError')
  })
})
