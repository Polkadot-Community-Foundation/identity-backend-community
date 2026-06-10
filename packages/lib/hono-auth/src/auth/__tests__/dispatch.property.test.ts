import { describe, it } from '@effect/vitest'
import { FastCheck as fc } from 'effect'
import { decideAndroidDispatch } from '../dispatch.js'

const KNOWN_TYPES = ['play-integrity', 'key-attestation'] as const

const optString = fc.option(fc.string(), { nil: undefined })

const attestationType = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.constantFrom(...KNOWN_TYPES),
  fc.string(),
)

const nonKeyAttestationType = attestationType.filter((t) => t !== 'key-attestation')

const androidSignal = fc.oneof(
  fc.record({ androidPackage: fc.string(), attestationToken: optString }),
  fc.record({ androidPackage: fc.constant<string | undefined>(undefined), attestationToken: fc.string() }),
)

describe('decideAndroidDispatch', () => {
  it.prop(
    '∀Headers_IosPackagePresent_=Skip',
    [fc.string(), optString, optString, attestationType],
    ([iosPackage, androidPackage, attestationToken, type]) =>
      decideAndroidDispatch({ iosPackage, androidPackage, attestationToken, attestationType: type })._tag === 'Skip',
  )

  it.prop(
    '∀Headers_KeyAttestationTypeNonIos_=KeyAttestation',
    [optString, optString],
    ([androidPackage, attestationToken]) =>
      decideAndroidDispatch({
        iosPackage: undefined,
        androidPackage,
        attestationToken,
        attestationType: 'key-attestation',
      })._tag === 'KeyAttestation',
  )

  it.prop(
    '∀Headers_NoAndroidSignalsNonKeyAttestation_=Skip',
    [nonKeyAttestationType],
    ([type]) =>
      decideAndroidDispatch({
        iosPackage: undefined,
        androidPackage: undefined,
        attestationToken: undefined,
        attestationType: type,
      })._tag === 'Skip',
  )

  it.prop(
    '∀Headers_AndroidSignalNoType_=MissingType',
    [androidSignal],
    ([{ androidPackage, attestationToken }]) =>
      decideAndroidDispatch({
        iosPackage: undefined,
        androidPackage,
        attestationToken,
        attestationType: undefined,
      })._tag === 'MissingAttestationType',
  )

  it.prop(
    '∀Headers_AndroidSignalPlayIntegrity_=PlayIntegrity',
    [androidSignal],
    ([{ androidPackage, attestationToken }]) =>
      decideAndroidDispatch({
        iosPackage: undefined,
        androidPackage,
        attestationToken,
        attestationType: 'play-integrity',
      })._tag === 'PlayIntegrity',
  )

  it.prop(
    '∀Headers_AndroidSignalUnknownType_=UnknownType',
    [androidSignal, fc.string().filter((s) => !KNOWN_TYPES.includes(s as typeof KNOWN_TYPES[number]))],
    ([{ androidPackage, attestationToken }, type]) =>
      decideAndroidDispatch({
        iosPackage: undefined,
        androidPackage,
        attestationToken,
        attestationType: type,
      })._tag === 'UnknownAttestationType',
  )
})
