import { Platform } from './types.js'

/**
 * Detect platform (iOS or Android) from device token format.
 *
 * iOS (APNs) tokens are 32-128 hexadecimal characters.
 * Per Apple documentation, device tokens are variable length
 * @see https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns
 *
 * Android (FCM) tokens contain non-hex characters (typically alphanumeric + -_:) and are 50+ characters.
 * Per Firebase documentation, FCM token format is unspecified and can change.
 * @see https://firebase.google.com/docs/cloud-messaging/manage-tokens
 *
 * @param deviceToken - The device token to analyze
 * @param platformHint - Optional platform hint that takes precedence over detection
 * @returns Detected or hinted platform ('ios' | 'android')
 */
export function detectFromDeviceToken(deviceToken: string, platformHint?: Platform): Platform {
  if (platformHint) {
    return platformHint
  }

  const isIOSToken = /^[0-9a-fA-F]{32,128}$/.test(deviceToken)

  return isIOSToken ? 'ios' : 'android'
}

export { Platform }
