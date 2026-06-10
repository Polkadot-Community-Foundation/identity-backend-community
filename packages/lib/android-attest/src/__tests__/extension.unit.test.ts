import { RootOfTrust, VerifiedBootState } from '@peculiar/asn1-android'
import { OctetString } from '@peculiar/asn1-schema'
import { Either, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { AttestationChallenge, PackageName } from '../attestation.types.js'
import {
  ANDROID_ATTESTATION_OID,
  AttestationExtensionParseError,
  ChallengeMismatchError,
  DeviceNotLockedError,
  ExtensionOnNonLeafError,
  findExtensionCertificate,
  KeymasterSecurityLevelTooLowError,
  MissingRootOfTrustError,
  PackageNameMismatchError,
  parseAttestationExtension,
  SecurityLevelTooLowError,
  validateParsedDescription,
  VerifiedBootStateNotVerifiedError,
} from '../extension.js'

import type { ParsedDescription } from '../extension.js'
const CHALLENGE = AttestationChallenge.make(new Uint8Array([1, 2, 3, 4]))
const POLKADOT_APP = [PackageName.make('io.pcf.polkadotapp')]
const OTHER_APP = [PackageName.make('com.other.app')]
const MULTI_APP = [PackageName.make('com.other.app'), PackageName.make('io.pcf.polkadotapp')]

const verifiedRoot = (): RootOfTrust =>
  new RootOfTrust({
    verifiedBootKey: new OctetString(new Uint8Array([0, 1, 2, 3])),
    deviceLocked: true,
    verifiedBootState: VerifiedBootState.verified,
  })

const makeParsedDesc = (overrides?: Partial<ParsedDescription>): ParsedDescription => ({
  attestationSecurityLevel: 1,
  keymasterSecurityLevel: 1,
  attestationChallenge: CHALLENGE,
  packageInfos: [{ packageName: 'io.pcf.polkadotapp' }],
  signingDigests: [new Uint8Array([10, 11, 12])],
  rootOfTrust: verifiedRoot(),
  ...overrides,
})

describe('validateParsedDescription', () => {
  it('Should_ReturnRight_When_AllFieldsValid', () => {
    const result = validateParsedDescription(makeParsedDesc(), CHALLENGE, POLKADOT_APP)
    expect(result).toEqual(
      Either.right({
        attestationSecurityLevel: 1,
        keymasterSecurityLevel: 1,
        attestationChallenge: CHALLENGE,
        packageName: 'io.pcf.polkadotapp',
        signingDigests: [new Uint8Array([10, 11, 12])],
      }),
    )
  })

  it('Should_ReturnRight_When_PackageMatchesAnyExpectedPackageName', () => {
    const result = validateParsedDescription(makeParsedDesc(), CHALLENGE, MULTI_APP)
    expect(result).toEqual(
      Either.right({
        attestationSecurityLevel: 1,
        keymasterSecurityLevel: 1,
        attestationChallenge: CHALLENGE,
        packageName: 'io.pcf.polkadotapp',
        signingDigests: [new Uint8Array([10, 11, 12])],
      }),
    )
  })

  it('Should_ReturnRight_When_SigningDigestsEmpty', () => {
    const parsed = makeParsedDesc({ signingDigests: [] })
    const result = validateParsedDescription(parsed, CHALLENGE, POLKADOT_APP)
    expect(result).toEqual(
      Either.right({
        attestationSecurityLevel: 1,
        keymasterSecurityLevel: 1,
        attestationChallenge: CHALLENGE,
        packageName: 'io.pcf.polkadotapp',
        signingDigests: [],
      }),
    )
  })

  it('Should_ReturnSecurityLevelTooLow_When_AttestationLevelIs0', () => {
    const result = validateParsedDescription(
      makeParsedDesc({ attestationSecurityLevel: 0 }),
      CHALLENGE,
      POLKADOT_APP,
    )
    expect(result).toEqual(Either.left(new SecurityLevelTooLowError({ securityLevel: 0 })))
  })

  it('Should_ReturnKeymasterSecurityLevelTooLow_When_KeymasterLevelIs0', () => {
    const result = validateParsedDescription(
      makeParsedDesc({ keymasterSecurityLevel: 0 }),
      CHALLENGE,
      POLKADOT_APP,
    )
    expect(result).toEqual(Either.left(new KeymasterSecurityLevelTooLowError({ securityLevel: 0 })))
  })

  it('Should_ReturnMissingRootOfTrust_When_RootOfTrustAbsent', () => {
    const result = validateParsedDescription(
      makeParsedDesc({ rootOfTrust: undefined }),
      CHALLENGE,
      POLKADOT_APP,
    )
    expect(result).toEqual(Either.left(new MissingRootOfTrustError({})))
  })

  it('Should_ReturnVerifiedBootStateNotVerified_When_StateIsUnverified', () => {
    const rot = verifiedRoot()
    rot.verifiedBootState = VerifiedBootState.unverified
    const result = validateParsedDescription(makeParsedDesc({ rootOfTrust: rot }), CHALLENGE, POLKADOT_APP)
    expect(result).toEqual(
      Either.left(new VerifiedBootStateNotVerifiedError({ state: VerifiedBootState.unverified })),
    )
  })

  it('Should_ReturnDeviceNotLocked_When_DeviceLockedIsFalse', () => {
    const rot = verifiedRoot()
    rot.deviceLocked = false
    const result = validateParsedDescription(makeParsedDesc({ rootOfTrust: rot }), CHALLENGE, POLKADOT_APP)
    expect(result).toEqual(Either.left(new DeviceNotLockedError({})))
  })

  it('Should_ReturnChallengeMismatch_When_ChallengeLengthDiffers', () => {
    const result = validateParsedDescription(
      makeParsedDesc({ attestationChallenge: new Uint8Array([9, 9, 9]) }),
      CHALLENGE,
      POLKADOT_APP,
    )
    expect(result).toEqual(Either.left(new ChallengeMismatchError({ expected: 'AQIDBA==', actual: 'CQkJ' })))
  })

  it('Should_ReturnChallengeMismatch_When_ChallengeContentDiffersAtEqualLength', () => {
    const result = validateParsedDescription(
      makeParsedDesc({ attestationChallenge: new Uint8Array([1, 2, 3, 5]) }),
      CHALLENGE,
      POLKADOT_APP,
    )
    expect(result).toEqual(Either.left(new ChallengeMismatchError({ expected: 'AQIDBA==', actual: 'AQIDBQ==' })))
  })

  it('Should_ReturnPackageNameMismatch_When_PackageNameDiffers', () => {
    const result = validateParsedDescription(makeParsedDesc(), CHALLENGE, OTHER_APP)
    expect(result).toEqual(
      Either.left(new PackageNameMismatchError({ expected: 'com.other.app', actual: 'io.pcf.polkadotapp' })),
    )
  })

  it('Should_ReturnPackageNameMismatch_When_PackageInfosEmpty', () => {
    const result = validateParsedDescription(makeParsedDesc({ packageInfos: [] }), CHALLENGE, POLKADOT_APP)
    expect(result).toEqual(
      Either.left(new PackageNameMismatchError({ expected: 'io.pcf.polkadotapp', actual: '' })),
    )
  })

  it('Should_ReturnPackageNameMismatch_When_AnyPackageInfoMismatches', () => {
    const parsed = makeParsedDesc({
      packageInfos: [
        { packageName: 'io.pcf.polkadotapp' },
        { packageName: 'com.attacker.evil' },
      ],
    })
    const result = validateParsedDescription(parsed, CHALLENGE, POLKADOT_APP)
    expect(result).toEqual(
      Either.left(new PackageNameMismatchError({ expected: 'io.pcf.polkadotapp', actual: 'com.attacker.evil' })),
    )
  })
})

describe('findExtensionCertificate', () => {
  it('Should_FindOnLeaf_When_LeafCarriesTheOID', () => {
    const value = new ArrayBuffer(16)
    const certs = [
      { extensions: [{ oid: ANDROID_ATTESTATION_OID, value }] },
      { extensions: [{ oid: '1.2.3.4', value: new ArrayBuffer(8) }] },
    ]
    expect(findExtensionCertificate(certs)).toEqual(
      Either.right(Option.some({ certIndex: 0, extensionValue: value })),
    )
  })

  it('Should_ReturnExtensionOnNonLeaf_When_ExtensionFoundOnIntermediate', () => {
    const certs = [
      { extensions: [{ oid: '1.2.3.4', value: new ArrayBuffer(8) }] },
      { extensions: [{ oid: ANDROID_ATTESTATION_OID, value: new ArrayBuffer(16) }] },
    ]
    expect(findExtensionCertificate(certs)).toEqual(Either.left(new ExtensionOnNonLeafError({ certIndex: 1 })))
  })

  it('Should_ReturnOptionNone_When_NoCertHasMatchingOID', () => {
    expect(findExtensionCertificate([{ extensions: [{ oid: '1.2.3.4', value: new ArrayBuffer(8) }] }])).toEqual(
      Either.right(Option.none()),
    )
  })

  it('Should_ReturnOptionNone_When_ChainIsEmpty', () => {
    expect(findExtensionCertificate([])).toEqual(Either.right(Option.none()))
  })
})

describe('parseAttestationExtension error handling', () => {
  it('Should_ReturnLeft_When_ExtensionValueIsInvalid', () => {
    const result = parseAttestationExtension(
      new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer,
      AttestationChallenge.make(new Uint8Array(3)),
      POLKADOT_APP,
    )
    expect(result).toEqual(Either.left(new AttestationExtensionParseError({ reason: 'All ASN.1 parsers failed' })))
  })

  it('Should_ReturnLeft_When_GivenEmptyBuffer', () => {
    const result = parseAttestationExtension(
      new ArrayBuffer(0),
      AttestationChallenge.make(new Uint8Array(16)),
      POLKADOT_APP,
    )
    expect(result).toEqual(Either.left(new AttestationExtensionParseError({ reason: 'All ASN.1 parsers failed' })))
  })
})
