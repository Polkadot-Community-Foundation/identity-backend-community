import { Schema as S } from 'effect'
import {
  AppLicensingVerdict,
  AppRecognitionVerdict,
  DeviceRecognitionVerdict,
  PlayIntegrityErrorCode,
  PlayIntegrityMode,
  PlayIntegrityToken,
} from './types.js'

export class PlayIntegrityAccepted extends S.TaggedClass<PlayIntegrityAccepted>()('PlayIntegrityAccepted', {}) {}

export class PlayIntegrityRejected extends S.TaggedClass<PlayIntegrityRejected>()('PlayIntegrityRejected', {
  codes: S.Array(PlayIntegrityErrorCode),
}) {}

export const PlayIntegrityValidation = S.Union(PlayIntegrityAccepted, PlayIntegrityRejected)
export type PlayIntegrityValidation = S.Schema.Type<typeof PlayIntegrityValidation>

interface ModePolicy {
  readonly acceptAppRecognition: ReadonlySet<AppRecognitionVerdict>
  readonly acceptDeviceRecognition: ReadonlySet<DeviceRecognitionVerdict>
  readonly acceptEmptyDeviceRecognition: boolean
  readonly acceptAppLicensing: ReadonlySet<AppLicensingVerdict>
}

const STRICT_POLICY: ModePolicy = {
  acceptAppRecognition: new Set<AppRecognitionVerdict>(['PLAY_RECOGNIZED']),
  acceptDeviceRecognition: new Set<DeviceRecognitionVerdict>(['MEETS_STRONG_INTEGRITY', 'MEETS_DEVICE_INTEGRITY']),
  acceptEmptyDeviceRecognition: false,
  acceptAppLicensing: new Set<AppLicensingVerdict>(['LICENSED']),
}

const RELAXED_DEVICE_POLICY: ModePolicy = {
  acceptAppRecognition: new Set<AppRecognitionVerdict>(['PLAY_RECOGNIZED']),
  acceptDeviceRecognition: new Set<DeviceRecognitionVerdict>([
    'MEETS_DEVICE_INTEGRITY',
    'MEETS_BASIC_INTEGRITY',
    'MEETS_STRONG_INTEGRITY',
  ]),
  acceptEmptyDeviceRecognition: false,
  acceptAppLicensing: new Set<AppLicensingVerdict>(['LICENSED']),
}

const RELAXED_ALL_POLICY: ModePolicy = {
  acceptAppRecognition: new Set<AppRecognitionVerdict>(['PLAY_RECOGNIZED', 'UNRECOGNIZED_VERSION', 'UNEVALUATED']),
  acceptDeviceRecognition: new Set<DeviceRecognitionVerdict>([
    'MEETS_DEVICE_INTEGRITY',
    'MEETS_BASIC_INTEGRITY',
    'MEETS_STRONG_INTEGRITY',
    'MEETS_VIRTUAL_INTEGRITY',
  ]),
  acceptEmptyDeviceRecognition: true,
  acceptAppLicensing: new Set<AppLicensingVerdict>(['LICENSED', 'UNLICENSED', 'UNEVALUATED']),
}

const MODE_POLICY: Readonly<Record<PlayIntegrityMode, ModePolicy>> = {
  strict: STRICT_POLICY,
  relaxed_device: RELAXED_DEVICE_POLICY,
  relaxed_all: RELAXED_ALL_POLICY,
}

const anyAccepted = <T extends string>(
  values: ReadonlyArray<T> | null,
  accepted: ReadonlySet<T>,
): boolean => {
  if (values === null) return false
  for (const value of values) {
    if (accepted.has(value)) return true
  }
  return false
}

export const validatePlayIntegrityToken = (
  mode: PlayIntegrityMode,
  token: PlayIntegrityToken,
): PlayIntegrityValidation => {
  const policy = MODE_POLICY[mode]
  const errors: PlayIntegrityErrorCode[] = []

  if (
    token.appRecognitionVerdict === null ||
    !policy.acceptAppRecognition.has(token.appRecognitionVerdict)
  ) {
    errors.push('APP_INTEGRITY_FAILED')
  }

  const deviceEmpty = token.deviceRecognitionVerdict === null ||
    token.deviceRecognitionVerdict.length === 0
  if (
    !anyAccepted(token.deviceRecognitionVerdict, policy.acceptDeviceRecognition) &&
    !(deviceEmpty && policy.acceptEmptyDeviceRecognition)
  ) {
    errors.push('DEVICE_INTEGRITY_FAILED')
  }

  if (
    token.appLicensingVerdict === null ||
    !policy.acceptAppLicensing.has(token.appLicensingVerdict)
  ) {
    errors.push('LICENSE_CHECK_FAILED')
  }

  return errors.length === 0
    ? new PlayIntegrityAccepted({})
    : new PlayIntegrityRejected({ codes: errors })
}
