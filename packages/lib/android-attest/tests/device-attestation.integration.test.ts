import { describe, expect, it } from '@effect/vitest'
import { decodeBase64 } from '@std/encoding'
import { Effect, Either } from 'effect'
import { verifyAndroidAttestation } from '../src/attestation.js'
import { AttestationChallenge, CertificateChainError, PackageName, SigningDigestHex } from '../src/attestation.types.js'
import { RootNotTrustedError } from '../src/certificates.js'
import type { CrlEntry } from '../src/crl.js'
import { GOOGLE_ROOT_CERTS } from '../src/roots.js'
import {
  APP_SIGNING_DIGEST_HEX,
  ATTESTATION_PACKAGE_NAME,
  CHAINS_VALID_AT,
  EMULATOR_CHAIN,
  EMULATOR_CHALLENGE_B64,
  REAL_DEVICE_CHAIN,
  REAL_DEVICE_CHALLENGE_B64,
} from './fixtures/device-attestation-chains.js'

const emptyCrl: Readonly<Record<string, CrlEntry>> = {}

const knownDigests = {
  playStore: SigningDigestHex.make('00'.repeat(32)),
  website: SigningDigestHex.make(APP_SIGNING_DIGEST_HEX),
}

const toDer = (b64: string): ArrayBuffer => {
  const bytes = decodeBase64(b64)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

const verifyDeviceChain = (challengeB64: string, chain: ReadonlyArray<string>) =>
  Effect.either(
    verifyAndroidAttestation({
      expectedPackageNames: [PackageName.make(ATTESTATION_PACKAGE_NAME)],
      expectedChallenge: AttestationChallenge.make(decodeBase64(challengeB64)),
      knownDigests,
      crlEntries: emptyCrl,
      googleRootPems: GOOGLE_ROOT_CERTS,
      now: CHAINS_VALID_AT,
    })({
      leafCertDer: toDer(chain[0]!),
      intermediateCertDers: chain.slice(1).map(toDer),
    }),
  )

describe('verifyAndroidAttestation against captured device chains', () => {
  it.effect('Should_RejectAsRootNotTrusted_When_ChainIsFromEmulatorTestRoot', () =>
    Effect.gen(function*() {
      const result = yield* verifyDeviceChain(EMULATOR_CHALLENGE_B64, EMULATOR_CHAIN)
      expect(result).toEqual(Either.left(new CertificateChainError({ cause: new RootNotTrustedError({}) })))
    }))

  it.effect('Should_VerifyAgainstGoogleRoot_When_ChainIsFromRealHardware', () =>
    Effect.gen(function*() {
      const result = yield* verifyDeviceChain(REAL_DEVICE_CHALLENGE_B64, REAL_DEVICE_CHAIN)
      expect(result).toEqual(Either.right({ appFromOfficialStore: false }))
    }))
})
