import { describe, it } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { Schema as S } from 'effect'
import { PlayIntegrityErrorCode, PlayIntegrityMode, PlayIntegrityToken } from '../types.js'
import {
  PlayIntegrityAccepted,
  PlayIntegrityRejected,
  PlayIntegrityValidation,
  validatePlayIntegrityToken,
} from '../validation.js'

const KNOWN_ERROR_CODES = new Set<string>([
  'APP_INTEGRITY_FAILED',
  'DEVICE_INTEGRITY_FAILED',
  'LICENSE_CHECK_FAILED',
])

const isRejected = (v: PlayIntegrityValidation): v is PlayIntegrityRejected => v._tag === 'PlayIntegrityRejected'

const codesOf = (v: PlayIntegrityValidation): ReadonlySet<PlayIntegrityErrorCode> =>
  isRejected(v) ? new Set(v.codes) : new Set()

const AppRecognitionVerdict = S.Literal('PLAY_RECOGNIZED', 'UNRECOGNIZED_VERSION', 'UNEVALUATED')
const DeviceRecognitionVerdict = S.Literal(
  'MEETS_DEVICE_INTEGRITY',
  'MEETS_BASIC_INTEGRITY',
  'MEETS_STRONG_INTEGRITY',
  'MEETS_VIRTUAL_INTEGRITY',
)
const AppLicensingVerdict = S.Literal('LICENSED', 'UNLICENSED', 'UNEVALUATED')

const relax = (): PlayIntegrityToken => ({
  appRecognitionVerdict: 'PLAY_RECOGNIZED',
  deviceRecognitionVerdict: ['MEETS_STRONG_INTEGRITY'],
  appLicensingVerdict: 'LICENSED',
})

const TokenWith = (
  fields: Partial<{
    appRecognitionVerdict: S.Schema.Type<typeof AppRecognitionVerdict>
    deviceRecognitionVerdict: ReadonlyArray<S.Schema.Type<typeof DeviceRecognitionVerdict>>
    appLicensingVerdict: S.Schema.Type<typeof AppLicensingVerdict>
  }>,
): PlayIntegrityToken => ({
  appRecognitionVerdict: fields.appRecognitionVerdict ?? null,
  deviceRecognitionVerdict: fields.deviceRecognitionVerdict ?? null,
  appLicensingVerdict: fields.appLicensingVerdict ?? null,
})

describe('Rule of Schemas', () => {
  ruleOfSchemas('PlayIntegrityToken', PlayIntegrityToken)
  ruleOfSchemas('PlayIntegrityMode', PlayIntegrityMode)
})

describe('validatePlayIntegrityToken — mode monotonicity', () => {
  it.prop('∀Token_ModeHierarchy_⊇Errors', [PlayIntegrityToken], ([token]) => {
    const strict = codesOf(validatePlayIntegrityToken('strict', token))
    const device = codesOf(validatePlayIntegrityToken('relaxed_device', token))
    const all = codesOf(validatePlayIntegrityToken('relaxed_all', token))
    for (const code of all) {
      if (!device.has(code)) return false
    }
    for (const code of device) {
      if (!strict.has(code)) return false
    }
    return true
  })
})

describe('validatePlayIntegrityToken — verdict-set semantics', () => {
  it.prop(
    '∀Token_AddStrongVerdict_⊥DeviceError',
    [PlayIntegrityToken],
    ([token]) => {
      const before = codesOf(validatePlayIntegrityToken('strict', token))
      const current = token.deviceRecognitionVerdict ?? []
      if (current.includes('MEETS_STRONG_INTEGRITY')) return true
      const improved = TokenWith({
        appRecognitionVerdict: token.appRecognitionVerdict ?? undefined,
        deviceRecognitionVerdict: [...current, 'MEETS_STRONG_INTEGRITY'],
        appLicensingVerdict: token.appLicensingVerdict ?? undefined,
      })
      const after = codesOf(validatePlayIntegrityToken('strict', improved))
      return !(!before.has('DEVICE_INTEGRITY_FAILED') && after.has('DEVICE_INTEGRITY_FAILED'))
    },
  )

  it.prop(
    '∀Token_AppRecognitionImprovement_⊥AppError',
    [PlayIntegrityToken],
    ([token]) => {
      const before = codesOf(validatePlayIntegrityToken('strict', token))
      const improved = TokenWith({
        appRecognitionVerdict: 'PLAY_RECOGNIZED',
        deviceRecognitionVerdict: token.deviceRecognitionVerdict ?? undefined,
        appLicensingVerdict: token.appLicensingVerdict ?? undefined,
      })
      const after = codesOf(validatePlayIntegrityToken('strict', improved))
      return !(!before.has('APP_INTEGRITY_FAILED') && after.has('APP_INTEGRITY_FAILED'))
    },
  )

  it.prop(
    '∀Token_LicensingImprovement_⊥LicenseError',
    [PlayIntegrityToken],
    ([token]) => {
      const before = codesOf(validatePlayIntegrityToken('strict', token))
      const improved = TokenWith({
        appRecognitionVerdict: token.appRecognitionVerdict ?? undefined,
        deviceRecognitionVerdict: token.deviceRecognitionVerdict ?? undefined,
        appLicensingVerdict: 'LICENSED',
      })
      const after = codesOf(validatePlayIntegrityToken('strict', improved))
      return !(!before.has('LICENSE_CHECK_FAILED') && after.has('LICENSE_CHECK_FAILED'))
    },
  )
})

describe('validatePlayIntegrityToken — maximal token always accepted', () => {
  it.prop(
    '∀Mode_MaximalToken_=Accepted',
    [PlayIntegrityMode],
    ([mode]) => validatePlayIntegrityToken(mode, relax()) instanceof PlayIntegrityAccepted,
  )
})

describe('validatePlayIntegrityToken — empty token semantics', () => {
  it.prop('∀Mode_EmptyToken_=EmitsExpectedCount', [PlayIntegrityMode], ([mode]) => {
    const result = validatePlayIntegrityToken(mode, {
      appRecognitionVerdict: null,
      deviceRecognitionVerdict: null,
      appLicensingVerdict: null,
    })
    if (mode === 'relaxed_all') return isRejected(result) && result.codes.length === 2
    return isRejected(result) && result.codes.length === 3
  })
})

describe('validatePlayIntegrityToken — code coverage', () => {
  it.prop('∀Token_ValidationResult_⊆KnownCodes', [PlayIntegrityMode, PlayIntegrityToken], ([mode, token]) => {
    const result = validatePlayIntegrityToken(mode, token)
    if (!isRejected(result)) return true
    for (const code of result.codes) {
      if (!KNOWN_ERROR_CODES.has(code)) return false
    }
    return true
  })
})
