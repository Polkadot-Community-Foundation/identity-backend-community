import { describe, expect, it } from '@effect/vitest'
import {
  AttestationApplicationId,
  AttestationPackageInfo,
  AuthorizationList,
  KeyMintKeyDescription,
  RootOfTrust,
  SecurityLevel,
  VerifiedBootState,
} from '@peculiar/asn1-android'
import { AsnSerializer, OctetString } from '@peculiar/asn1-schema'
import {
  BasicConstraintsExtension,
  Extension,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509CertificateGenerator,
} from '@peculiar/x509'
import { Effect, Either, Option } from 'effect'
import { verifyAndroidAttestation } from '../src/attestation.js'
import {
  AttestationChallenge,
  AttestationStatementError,
  CertificateChainError,
  PackageName,
  SigningDigestHex,
} from '../src/attestation.types.js'
import { ChainTooLongError, ChainVerificationFailedError } from '../src/certificates.js'
import type { CrlEntry } from '../src/crl.js'
import { CertificateRevokedError } from '../src/crl.js'
import {
  DeviceNotLockedError,
  ExtensionOnNonLeafError,
  KeymasterSecurityLevelTooLowError,
  MissingRootOfTrustError,
  NoAttestationExtensionError,
  SecurityLevelTooLowError,
  UntrustedVerifiedBootKeyError,
  VerifiedBootStateNotVerifiedError,
} from '../src/extension.js'
import { GRAPHENEOS_VERIFIED_BOOT_KEYS } from '../src/verified-boot-keys.js'
import {
  GRAPHENEOS_CERTIFICATE_CHAIN,
  GRAPHENEOS_CHAIN_CHALLENGE,
  GRAPHENEOS_CHAIN_GOOGLE_ROOT_PEM,
  GRAPHENEOS_CHAIN_PACKAGE_NAME,
  GRAPHENEOS_CHAIN_SIGNING_DIGEST_HEX,
  GRAPHENEOS_CHAIN_VALID_AT,
  GRAPHENEOS_CHAIN_VERIFIED_BOOT_KEY_HEX,
  TEST_CERTIFICATE_CHAIN,
  TEST_CERTIFICATE_CHAIN_CHALLENGE,
  TEST_CERTIFICATE_CHAIN_GOOGLE_ROOT_PEM,
  TEST_CERTIFICATE_CHAIN_PACKAGE_NAME,
  TEST_CERTIFICATE_CHAIN_SIGNING_DIGEST_HEX,
} from './fixtures/test-certificate-chain.js'

const PLAY_STORE_DIGEST_HEX = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const WEBSITE_DIGEST_HEX = 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5'

const hexToBytes = (hex: string): Uint8Array => new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))

const knownDigests = {
  playStore: SigningDigestHex.make(PLAY_STORE_DIGEST_HEX),
  website: SigningDigestHex.make(WEBSITE_DIGEST_HEX),
}

const emptyCrl: Readonly<Record<string, CrlEntry>> = {}

const CHALLENGE_BYTES = new Uint8Array(16).fill(7)

const baseOptions = {
  expectedPackageNames: [PackageName.make('io.pcf.polkadotapp')],
  expectedChallenge: AttestationChallenge.make(CHALLENGE_BYTES),
  knownDigests,
  crlEntries: emptyCrl,
}

interface BuildExtOpts {
  readonly attestationSecurityLevel?: SecurityLevel
  readonly keyMintSecurityLevel?: SecurityLevel
  readonly includeRootOfTrust?: boolean
  readonly verifiedBootState?: VerifiedBootState
  readonly deviceLocked?: boolean
  readonly packageName?: string
  readonly signingDigestHex?: string
  readonly challenge?: Uint8Array
}

const buildAttestationExtensionValue = (opts: BuildExtOpts = {}): ArrayBuffer => {
  const appId = new AttestationApplicationId({
    packageInfos: [
      new AttestationPackageInfo({
        packageName: new OctetString(new TextEncoder().encode(opts.packageName ?? 'io.pcf.polkadotapp')),
        version: 1,
      }),
    ],
    signatureDigests: [new OctetString(hexToBytes(opts.signingDigestHex ?? PLAY_STORE_DIGEST_HEX))],
  })
  const appIdBytes = AsnSerializer.serialize(appId)

  const hardware = new AuthorizationList({
    attestationApplicationId: new OctetString(appIdBytes),
    rootOfTrust: opts.includeRootOfTrust === false ? undefined : new RootOfTrust({
      verifiedBootKey: new OctetString(new Uint8Array(32)),
      deviceLocked: opts.deviceLocked ?? true,
      verifiedBootState: opts.verifiedBootState ?? VerifiedBootState.verified,
    }),
  })

  const keyDesc = new KeyMintKeyDescription({
    attestationVersion: 100,
    attestationSecurityLevel: opts.attestationSecurityLevel ?? SecurityLevel.trustedEnvironment,
    keyMintVersion: 100,
    keyMintSecurityLevel: opts.keyMintSecurityLevel ?? SecurityLevel.trustedEnvironment,
    attestationChallenge: new OctetString(opts.challenge ?? CHALLENGE_BYTES),
    uniqueId: new OctetString(new Uint8Array(0)),
    softwareEnforced: new AuthorizationList(),
    hardwareEnforced: hardware,
  })

  return AsnSerializer.serialize(keyDesc)
}

interface ChainOptions {
  readonly extraIntermediates?: number
  readonly extensionValue?: ArrayBuffer
  readonly extensionOnIntermediate?: boolean
}

async function generateTestChain(opts: ChainOptions = {}) {
  const rootKey = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify'])
  const rootCert = await X509CertificateGenerator.create({
    serialNumber: '01',
    subject: 'CN=Test Root CA',
    issuer: 'CN=Test Root CA',
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 86400_000),
    signingKey: rootKey.privateKey,
    publicKey: rootKey.publicKey,
    extensions: [
      new BasicConstraintsExtension(true, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    ],
  })

  const intermediates: Array<{
    cert: Awaited<ReturnType<typeof X509CertificateGenerator.create>>
    privateKey: CryptoKey
  }> = []
  let signerKey = rootKey
  let signerSubject = rootCert.subject
  const intermediateCount = 1 + (opts.extraIntermediates ?? 0)
  for (let i = 0; i < intermediateCount; i++) {
    const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify'])
    const cert = await X509CertificateGenerator.create({
      serialNumber: `1${i}`,
      subject: `CN=Test Intermediate CA ${i}`,
      issuer: signerSubject,
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 365 * 86400_000),
      signingKey: signerKey.privateKey,
      publicKey: key.publicKey,
      extensions: [
        new BasicConstraintsExtension(true, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
        ...(opts.extensionOnIntermediate && i === 0
          ? [new Extension('1.3.6.1.4.1.11129.2.1.17', false, new ArrayBuffer(4))]
          : []),
      ],
    })
    intermediates.push({ cert, privateKey: key.privateKey })
    signerKey = key
    signerSubject = cert.subject
  }

  const leafKey = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify'])
  const leafCert = await X509CertificateGenerator.create({
    serialNumber: '99',
    subject: 'CN=test.example.com',
    issuer: signerSubject,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 86400_000),
    signingKey: signerKey.privateKey,
    publicKey: leafKey.publicKey,
    extensions: [
      new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
      ...(opts.extensionValue ? [new Extension('1.3.6.1.4.1.11129.2.1.17', false, opts.extensionValue)] : []),
    ],
  })

  return {
    leafCert,
    intermediates: intermediates.map((i) => i.cert).reverse(),
    rootCert,
    rootPem: rootCert.toString(),
  }
}

describe('verifyAndroidAttestation', () => {
  it.effect('Should_ReturnChainTooLong_When_ChainExceedsMaxLength', () =>
    Effect.gen(function*() {
      const result = yield* Effect.either(
        verifyAndroidAttestation(baseOptions)({
          leafCertDer: new ArrayBuffer(8),
          intermediateCertDers: Array.from({ length: 10 }, () => new ArrayBuffer(8)),
        }),
      )
      expect(result).toEqual(
        Either.left(new CertificateChainError({ cause: new ChainTooLongError({ length: 11, max: 10 }) })),
      )
    }))

  it.effect('Should_ReturnChainVerificationFailed_When_LeafCertIsInvalid', () =>
    Effect.gen(function*() {
      const result = yield* Effect.either(
        verifyAndroidAttestation(baseOptions)({
          leafCertDer: new Uint8Array([0, 1, 2]).buffer,
          intermediateCertDers: [],
        }),
      )
      expect(result).toEqual(
        Either.left(
          new CertificateChainError({
            cause: new ChainVerificationFailedError({ detail: 'Failed to parse leaf certificate' }),
          }),
        ),
      )
    }))

  it.effect('Should_ReturnSecurityLevelTooLow_When_DownloadedGoogleSoftwareAttestationChainIsUsed', () =>
    Effect.gen(function*() {
      const result = yield* Effect.either(
        verifyAndroidAttestation({
          expectedPackageNames: [PackageName.make(TEST_CERTIFICATE_CHAIN_PACKAGE_NAME)],
          expectedChallenge: AttestationChallenge.make(TEST_CERTIFICATE_CHAIN_CHALLENGE),
          knownDigests: {
            playStore: SigningDigestHex.make(PLAY_STORE_DIGEST_HEX),
            website: SigningDigestHex.make(TEST_CERTIFICATE_CHAIN_SIGNING_DIGEST_HEX),
          },
          crlEntries: emptyCrl,
          googleRootPems: [TEST_CERTIFICATE_CHAIN_GOOGLE_ROOT_PEM],
          now: new Date('2025-01-01T00:00:00.000Z'),
        })(TEST_CERTIFICATE_CHAIN),
      )

      expect(result).toEqual(
        Either.left(new AttestationStatementError({ cause: new SecurityLevelTooLowError({ securityLevel: 0 }) })),
      )
    }))

  it.effect('Should_ReturnRightWebsite_When_RealGrapheneOsBootKeyIsInPinnedAllowlist', () =>
    Effect.gen(function*() {
      const result = yield* Effect.either(
        verifyAndroidAttestation({
          expectedPackageNames: [PackageName.make(GRAPHENEOS_CHAIN_PACKAGE_NAME)],
          expectedChallenge: AttestationChallenge.make(GRAPHENEOS_CHAIN_CHALLENGE),
          knownDigests: {
            playStore: SigningDigestHex.make(PLAY_STORE_DIGEST_HEX),
            website: SigningDigestHex.make(GRAPHENEOS_CHAIN_SIGNING_DIGEST_HEX),
          },
          crlEntries: emptyCrl,
          googleRootPems: [GRAPHENEOS_CHAIN_GOOGLE_ROOT_PEM],
          trustedVerifiedBootKeys: GRAPHENEOS_VERIFIED_BOOT_KEYS,
          now: GRAPHENEOS_CHAIN_VALID_AT,
        })(GRAPHENEOS_CERTIFICATE_CHAIN),
      )

      expect(result).toEqual(Either.right({ appFromOfficialStore: false }))
    }))

  it.effect('Should_ReturnUntrustedVerifiedBootKey_When_SelfSignedBootKeyNotInAllowlist', () =>
    Effect.gen(function*() {
      const result = yield* Effect.either(
        verifyAndroidAttestation({
          expectedPackageNames: [PackageName.make(GRAPHENEOS_CHAIN_PACKAGE_NAME)],
          expectedChallenge: AttestationChallenge.make(GRAPHENEOS_CHAIN_CHALLENGE),
          knownDigests: {
            playStore: SigningDigestHex.make(PLAY_STORE_DIGEST_HEX),
            website: SigningDigestHex.make(GRAPHENEOS_CHAIN_SIGNING_DIGEST_HEX),
          },
          crlEntries: emptyCrl,
          googleRootPems: [GRAPHENEOS_CHAIN_GOOGLE_ROOT_PEM],
          now: GRAPHENEOS_CHAIN_VALID_AT,
        })(GRAPHENEOS_CERTIFICATE_CHAIN),
      )

      expect(result).toEqual(
        Either.left(
          new AttestationStatementError({
            cause: new UntrustedVerifiedBootKeyError({ keyHex: GRAPHENEOS_CHAIN_VERIFIED_BOOT_KEY_HEX }),
          }),
        ),
      )
    }))

  it.effect('Should_ReturnRight_When_SelfSignedBootKeyIsTrustedAndDeviceLocked', () =>
    Effect.gen(function*() {
      const trustedVerifiedBootKeys = new Set(['00'.repeat(32)])
      const extValue = buildAttestationExtensionValue({
        verifiedBootState: VerifiedBootState.selfSigned,
        signingDigestHex: PLAY_STORE_DIGEST_HEX,
      })
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() =>
        generateTestChain({ extensionValue: extValue })
      )
      const result = yield* Effect.either(
        verifyAndroidAttestation({
          ...baseOptions,
          googleRootPems: [rootPem],
          trustedVerifiedBootKeys,
          now: leafCert.notBefore,
        })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(Either.right({ appFromOfficialStore: true }))
    }))

  it('Should_ReturnEffect_When_Called', () => {
    const effect = verifyAndroidAttestation(baseOptions)({
      leafCertDer: new ArrayBuffer(8),
      intermediateCertDers: [],
    })
    expect(Effect.isEffect(effect)).toBe(true)
  })

  it.effect('Should_ReturnNoAttestationExtension_When_ChainValidButLacksAndroidExtension', () =>
    Effect.gen(function*() {
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() => generateTestChain())
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(Either.left(new AttestationStatementError({ cause: new NoAttestationExtensionError({}) })))
    }))

  it.effect('Should_ReturnExtensionOnNonLeaf_When_IntermediateCarriesAndroidOID', () =>
    Effect.gen(function*() {
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() =>
        generateTestChain({ extensionOnIntermediate: true })
      )
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(
        Either.left(new AttestationStatementError({ cause: new ExtensionOnNonLeafError({ certIndex: 1 }) })),
      )
    }))

  it.effect('Should_ReturnCertificateRevoked_When_LeafSerialIsInCrl', () =>
    Effect.gen(function*() {
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() => generateTestChain())
      const crlEntries: Record<string, CrlEntry> = {
        [leafCert.serialNumber.toLowerCase()]: { status: 'REVOKED', reason: Option.none() },
      }
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], crlEntries, now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(
        Either.left(new CertificateRevokedError({ serialHex: leafCert.serialNumber, position: 0 })),
      )
    }))

  it.effect('Should_ReturnCertificateRevoked_When_MiddleIntermediateSerialIsInCrl', () =>
    Effect.gen(function*() {
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() =>
        generateTestChain({ extraIntermediates: 1 })
      )
      const middle = intermediates[0]!
      const crlEntries: Record<string, CrlEntry> = {
        [middle.serialNumber.toLowerCase()]: { status: 'REVOKED', reason: Option.none() },
      }
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], crlEntries, now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(
        Either.left(new CertificateRevokedError({ serialHex: middle.serialNumber, position: 1 })),
      )
    }))

  it.effect('Should_ReturnSecurityLevelTooLow_When_AttestationSecurityLevelIsSoftware', () =>
    Effect.gen(function*() {
      const extValue = buildAttestationExtensionValue({ attestationSecurityLevel: SecurityLevel.software })
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() =>
        generateTestChain({ extensionValue: extValue })
      )
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(
        Either.left(new AttestationStatementError({ cause: new SecurityLevelTooLowError({ securityLevel: 0 }) })),
      )
    }))

  it.effect('Should_ReturnKeymasterSecurityLevelTooLow_When_KeyLevelIsSoftware', () =>
    Effect.gen(function*() {
      const extValue = buildAttestationExtensionValue({ keyMintSecurityLevel: SecurityLevel.software })
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() =>
        generateTestChain({ extensionValue: extValue })
      )
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(
        Either.left(
          new AttestationStatementError({ cause: new KeymasterSecurityLevelTooLowError({ securityLevel: 0 }) }),
        ),
      )
    }))

  it.effect('Should_ReturnMissingRootOfTrust_When_RootOfTrustAbsent', () =>
    Effect.gen(function*() {
      const extValue = buildAttestationExtensionValue({ includeRootOfTrust: false })
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() =>
        generateTestChain({ extensionValue: extValue })
      )
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(Either.left(new AttestationStatementError({ cause: new MissingRootOfTrustError({}) })))
    }))

  it.effect('Should_ReturnVerifiedBootStateNotVerified_When_StateIsUnverified', () =>
    Effect.gen(function*() {
      const extValue = buildAttestationExtensionValue({ verifiedBootState: VerifiedBootState.unverified })
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() =>
        generateTestChain({ extensionValue: extValue })
      )
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(
        Either.left(
          new AttestationStatementError({
            cause: new VerifiedBootStateNotVerifiedError({ state: VerifiedBootState.unverified }),
          }),
        ),
      )
    }))

  it.effect('Should_ReturnDeviceNotLocked_When_DeviceLockedIsFalse', () =>
    Effect.gen(function*() {
      const extValue = buildAttestationExtensionValue({ deviceLocked: false })
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() =>
        generateTestChain({ extensionValue: extValue })
      )
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(Either.left(new AttestationStatementError({ cause: new DeviceNotLockedError({}) })))
    }))

  it.effect('Should_ReturnRightPlayStore_When_AttestationIsValidAndDigestMatchesPlayStore', () =>
    Effect.gen(function*() {
      const extValue = buildAttestationExtensionValue({ signingDigestHex: PLAY_STORE_DIGEST_HEX })
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() =>
        generateTestChain({ extensionValue: extValue })
      )
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(Either.right({ appFromOfficialStore: true }))
    }))

  it.effect('Should_ReturnRightWebsite_When_AttestationIsValidAndDigestMatchesWebsite', () =>
    Effect.gen(function*() {
      const extValue = buildAttestationExtensionValue({ signingDigestHex: WEBSITE_DIGEST_HEX })
      const { leafCert, intermediates, rootPem } = yield* Effect.promise(() =>
        generateTestChain({ extensionValue: extValue })
      )
      const result = yield* Effect.either(
        verifyAndroidAttestation({ ...baseOptions, googleRootPems: [rootPem], now: leafCert.notBefore })({
          leafCertDer: leafCert.rawData,
          intermediateCertDers: intermediates.map((i) => i.rawData),
        }),
      )
      expect(result).toEqual(Either.right({ appFromOfficialStore: false }))
    }))
})
