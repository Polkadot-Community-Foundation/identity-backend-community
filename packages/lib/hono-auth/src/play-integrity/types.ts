import { Schema as S } from 'effect'

/**
 * Per-verdict acceptance rule for Play Integrity token validation.
 *
 * `strict`         — production: require a Play Store build on a
 *                    hardware-backed, non-rooted device.
 * `relaxed_device` — nightly/paseo: relax device integrity to permit
 *                    real devices that have not received the strongest
 *                    verdict, but keep app recognition and licensing
 *                    strict.
 * `relaxed_all`    — preview/debug: relax device integrity, app
 *                    recognition (allow `UNRECOGNIZED_VERSION` from
 *                    sideloaded builds) and licensing (allow
 *                    `UNLICENSED`).
 */
export const PlayIntegrityMode = S.Literal(
  'strict',
  'relaxed_device',
  'relaxed_all',
)

export type PlayIntegrityMode = S.Schema.Type<typeof PlayIntegrityMode>

export const AppRecognitionVerdict = S.Literal(
  'PLAY_RECOGNIZED',
  'UNRECOGNIZED_VERSION',
  'UNEVALUATED',
)
export type AppRecognitionVerdict = S.Schema.Type<typeof AppRecognitionVerdict>

export const DeviceRecognitionVerdict = S.Literal(
  'MEETS_DEVICE_INTEGRITY',
  'MEETS_BASIC_INTEGRITY',
  'MEETS_STRONG_INTEGRITY',
  'MEETS_VIRTUAL_INTEGRITY',
)
export type DeviceRecognitionVerdict = S.Schema.Type<typeof DeviceRecognitionVerdict>

export const AppLicensingVerdict = S.Literal(
  'LICENSED',
  'UNLICENSED',
  'UNEVALUATED',
)
export type AppLicensingVerdict = S.Schema.Type<typeof AppLicensingVerdict>

export const PlayIntegrityToken = S.Struct({
  appRecognitionVerdict: S.NullOr(AppRecognitionVerdict),
  deviceRecognitionVerdict: S.NullOr(S.Array(DeviceRecognitionVerdict)),
  appLicensingVerdict: S.NullOr(AppLicensingVerdict),
})
export type PlayIntegrityToken = S.Schema.Type<typeof PlayIntegrityToken>

export const PlayIntegrityErrorCode = S.Literal(
  'APP_INTEGRITY_FAILED',
  'DEVICE_INTEGRITY_FAILED',
  'LICENSE_CHECK_FAILED',
)

export type PlayIntegrityErrorCode = S.Schema.Type<typeof PlayIntegrityErrorCode>

export class InvalidTokenError extends S.Class<InvalidTokenError>('InvalidTokenError')({
  codes: S.Array(PlayIntegrityErrorCode),
}) {}

export class PlayIntegrityMiddlewareError
  extends S.TaggedError<PlayIntegrityMiddlewareError>('PlayIntegrityMiddlewareError')(
    'PlayIntegrityMiddlewareError',
    {
      cause: S.optionalWith(S.Unknown, { nullable: true }),
    },
  )
{}

export class IntegrityErrorResponse extends S.Class<IntegrityErrorResponse>('IntegrityErrorResponse')({
  error: S.String,
  errorCodes: S.Array(PlayIntegrityErrorCode),
}) {}

export { ConsumeChallengeError } from '@identity-backend/auth/types'
