// Contract test in oracle-substitute form. The real attestation issuer is
// Android Keystore hardware, which cannot run locally, so a pairwise
// Fake-vs-Real issuer comparison is impossible. The production verifier
// (verifyAndroidAttestation) is the oracle: the issuer is faithful iff every
// option it exposes earns the same verdict a hardware-issued attestation would.
// Residual risk: structure a hardware chain carries that the verifier does not
// inspect is not exercised here.

import { describe, expect, it } from '@effect/vitest'
import { SecurityLevel, VerifiedBootState } from '@peculiar/asn1-android'
import { encodeBase64 } from '@std/encoding'
import { Effect, Either, Option } from 'effect'
import { verifyAndroidAttestation } from '../src/attestation.js'
import {
  AttestationChallenge,
  AttestationStatementError,
  PackageName,
  SigningDigestHex,
} from '../src/attestation.types.js'
import type { CrlEntry } from '../src/crl.js'
import { CertificateRevokedError } from '../src/crl.js'
import {
  ChallengeMismatchError,
  DeviceNotLockedError,
  ExtensionOnNonLeafError,
  KeymasterSecurityLevelTooLowError,
  MissingRootOfTrustError,
  NoAttestationExtensionError,
  SecurityLevelTooLowError,
  VerifiedBootStateNotVerifiedError,
} from '../src/extension.js'
import {
  type AttestationExtensionOptions,
  buildAttestationExtensionValue,
  issueAttestationChain,
  type IssuedAttestationChain,
} from '../src/testing/mod.js'

const PACKAGE_NAME = 'io.example.attested.app'
const PLAY_STORE_DIGEST_HEX = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const WEBSITE_DIGEST_HEX = 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5'
const CHALLENGE = new Uint8Array(32).fill(7)

const knownDigests = {
  playStore: SigningDigestHex.make(PLAY_STORE_DIGEST_HEX),
  website: SigningDigestHex.make(WEBSITE_DIGEST_HEX),
}
const emptyCrl: Readonly<Record<string, CrlEntry>> = {}

type VerifierOptions = Parameters<typeof verifyAndroidAttestation>[0]

const extensionWith = (opts: Partial<AttestationExtensionOptions> = {}): ArrayBuffer =>
  buildAttestationExtensionValue({
    challenge: CHALLENGE,
    packageName: PACKAGE_NAME,
    signingDigestHex: PLAY_STORE_DIGEST_HEX,
    ...opts,
  })

const verifyChain = (chain: IssuedAttestationChain, overrides: Partial<VerifierOptions> = {}) =>
  Effect.either(
    verifyAndroidAttestation({
      expectedPackageNames: [PackageName.make(PACKAGE_NAME)],
      expectedChallenge: AttestationChallenge.make(CHALLENGE),
      knownDigests,
      crlEntries: emptyCrl,
      googleRootPems: [chain.rootPem],
      now: chain.leafCert.notBefore,
      ...overrides,
    })({
      leafCertDer: chain.leafCert.rawData,
      intermediateCertDers: chain.intermediates.map((intermediate) => intermediate.rawData),
    }),
  )

describe('Android attestation issuance contract', () => {
  it.effect('Should_VerifyAsPlayStore_When_DigestMatchesPlayStore', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() =>
        issueAttestationChain({ extensionValue: extensionWith({ signingDigestHex: PLAY_STORE_DIGEST_HEX }) })
      )
      const result = yield* verifyChain(chain)
      expect(result).toEqual(Either.right({ appFromOfficialStore: true }))
    }))

  it.effect('Should_VerifyAsWebsite_When_DigestMatchesWebsite', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() =>
        issueAttestationChain({ extensionValue: extensionWith({ signingDigestHex: WEBSITE_DIGEST_HEX }) })
      )
      const result = yield* verifyChain(chain)
      expect(result).toEqual(Either.right({ appFromOfficialStore: false }))
    }))

  it.effect('Should_RejectAsNoExtension_When_ChainHasNoAndroidExtension', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() => issueAttestationChain())
      const result = yield* verifyChain(chain)
      expect(result).toEqual(Either.left(new AttestationStatementError({ cause: new NoAttestationExtensionError({}) })))
    }))

  it.effect('Should_RejectAsExtensionOnNonLeaf_When_IntermediateCarriesExtension', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() =>
        issueAttestationChain({ extensionValue: extensionWith(), extensionOnIntermediate: true })
      )
      const result = yield* verifyChain(chain)
      expect(result).toEqual(
        Either.left(new AttestationStatementError({ cause: new ExtensionOnNonLeafError({ certIndex: 1 }) })),
      )
    }))

  it.effect('Should_RejectAsSecurityLevelTooLow_When_AttestationLevelIsSoftware', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() =>
        issueAttestationChain({ extensionValue: extensionWith({ attestationSecurityLevel: SecurityLevel.software }) })
      )
      const result = yield* verifyChain(chain)
      expect(result).toEqual(
        Either.left(new AttestationStatementError({ cause: new SecurityLevelTooLowError({ securityLevel: 0 }) })),
      )
    }))

  it.effect('Should_RejectAsKeymasterSecurityLevelTooLow_When_KeyMintLevelIsSoftware', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() =>
        issueAttestationChain({ extensionValue: extensionWith({ keyMintSecurityLevel: SecurityLevel.software }) })
      )
      const result = yield* verifyChain(chain)
      expect(result).toEqual(
        Either.left(
          new AttestationStatementError({ cause: new KeymasterSecurityLevelTooLowError({ securityLevel: 0 }) }),
        ),
      )
    }))

  it.effect('Should_RejectAsMissingRootOfTrust_When_RootOfTrustOmitted', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() =>
        issueAttestationChain({ extensionValue: extensionWith({ includeRootOfTrust: false }) })
      )
      const result = yield* verifyChain(chain)
      expect(result).toEqual(Either.left(new AttestationStatementError({ cause: new MissingRootOfTrustError({}) })))
    }))

  it.effect('Should_RejectAsBootStateNotVerified_When_BootStateIsUnverified', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() =>
        issueAttestationChain({ extensionValue: extensionWith({ verifiedBootState: VerifiedBootState.unverified }) })
      )
      const result = yield* verifyChain(chain)
      expect(result).toEqual(
        Either.left(
          new AttestationStatementError({
            cause: new VerifiedBootStateNotVerifiedError({ state: VerifiedBootState.unverified }),
          }),
        ),
      )
    }))

  it.effect('Should_RejectAsDeviceNotLocked_When_DeviceLockedIsFalse', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() =>
        issueAttestationChain({ extensionValue: extensionWith({ deviceLocked: false }) })
      )
      const result = yield* verifyChain(chain)
      expect(result).toEqual(Either.left(new AttestationStatementError({ cause: new DeviceNotLockedError({}) })))
    }))

  it.effect('Should_VerifyAsPlayStore_When_BootStateSelfSignedAndKeyTrusted', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() =>
        issueAttestationChain({ extensionValue: extensionWith({ verifiedBootState: VerifiedBootState.selfSigned }) })
      )
      const result = yield* verifyChain(chain, { trustedVerifiedBootKeys: new Set(['00'.repeat(32)]) })
      expect(result).toEqual(Either.right({ appFromOfficialStore: true }))
    }))

  it.effect('Should_RejectAsChallengeMismatch_When_ExpectedChallengeDiffersFromAttested', () =>
    Effect.gen(function*() {
      const wrongChallenge = new Uint8Array(32).fill(9)
      const chain = yield* Effect.promise(() => issueAttestationChain({ extensionValue: extensionWith() }))
      const result = yield* verifyChain(chain, { expectedChallenge: AttestationChallenge.make(wrongChallenge) })
      expect(result).toEqual(
        Either.left(
          new AttestationStatementError({
            cause: new ChallengeMismatchError({
              expected: encodeBase64(wrongChallenge),
              actual: encodeBase64(CHALLENGE),
            }),
          }),
        ),
      )
    }))

  it.effect('Should_RejectAsRevoked_When_LeafSerialIsInCrl', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() => issueAttestationChain())
      const crlEntries: Record<string, CrlEntry> = {
        [chain.leafCert.serialNumber.toLowerCase()]: { status: 'REVOKED', reason: Option.none() },
      }
      const result = yield* verifyChain(chain, { crlEntries })
      expect(result).toEqual(
        Either.left(new CertificateRevokedError({ serialHex: chain.leafCert.serialNumber, position: 0 })),
      )
    }))

  it.effect('Should_RejectAsRevoked_When_MiddleIntermediateSerialIsInCrl', () =>
    Effect.gen(function*() {
      const chain = yield* Effect.promise(() => issueAttestationChain({ extraIntermediates: 1 }))
      const middle = chain.intermediates[0]!
      const crlEntries: Record<string, CrlEntry> = {
        [middle.serialNumber.toLowerCase()]: { status: 'REVOKED', reason: Option.none() },
      }
      const result = yield* verifyChain(chain, { crlEntries })
      expect(result).toEqual(
        Either.left(new CertificateRevokedError({ serialHex: middle.serialNumber, position: 1 })),
      )
    }))
})
