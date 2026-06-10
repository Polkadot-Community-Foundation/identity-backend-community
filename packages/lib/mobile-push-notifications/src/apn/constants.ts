/**
 * Default expiry time for APN push notifications (in seconds).
 * Represents 1 hour — APNs will not retry after this duration.
 */
export const EXPIRY_DEFAULT_SECONDS = 3600

/**
 * APN topic suffix for VoIP push notifications.
 * Appended to topics when sending VoIP-specific notifications.
 * E.g., "com.example.app" becomes "com.example.app.voip"
 */
export const VOIP_TOPIC_SUFFIX = '.voip'

/**
 * Platform identifier for iOS push notifications.
 * Used in result aggregation to identify notification source.
 */
export const PLATFORM_IOS = 'ios'

/**
 * Minimum device token length (in characters).
 * iOS device tokens are typically 64 hex characters.
 * This is a soft validation; actual length may vary.
 */
export const DEVICE_TOKEN_MIN_LENGTH = 32

/**
 * Maximum device token length (in characters).
 * iOS device tokens are typically 64 hex characters.
 */
export const DEVICE_TOKEN_MAX_LENGTH = 128
