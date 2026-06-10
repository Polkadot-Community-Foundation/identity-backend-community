/// <reference types="vitest/importMeta" />
import { StrictHex } from '@identity-backend/schema-extensions'
import { Effect, Schema as S } from 'effect'
import { CertificateChainFailure } from './certificates.js'
import { CertificateRevokedError } from './crl.js'
import type { CrlEntry } from './crl.js'
import { AppDistributionFailure } from './distribution.js'
import { AttestationStatementFailure } from './extension.js'

export const PackageName = S.String.pipe(S.brand('PackageName'))
export type PackageName = typeof PackageName.Type

export const SerialHex = StrictHex.pipe(S.brand('SerialHex'))
export type SerialHex = typeof SerialHex.Type

export const SecurityLevel = S.NonNegativeInt.pipe(S.brand('SecurityLevel'))
export type SecurityLevel = typeof SecurityLevel.Type

export const AttestationChallenge = S.Uint8ArrayFromSelf.pipe(S.brand('AttestationChallenge'))
export type AttestationChallenge = typeof AttestationChallenge.Type

export const SigningDigestHex = StrictHex.pipe(
  S.filter(s => s.length === 64, {
    type: 'Sha256Digest',
    message: () => 'expected sha256 hex digest (64 chars)',
    arbitrary: () => (fc) => fc.hexaString({ minLength: 64, maxLength: 64 }),
  }),
  S.brand('SigningDigestHex'),
)
export type SigningDigestHex = typeof SigningDigestHex.Type

const AttestationErrorTypeId: unique symbol = Symbol.for('@identity-backend/android-attest/AttestationError')
export type AttestationErrorTypeId = typeof AttestationErrorTypeId

export class CertificateChainError extends S.TaggedError<CertificateChainError>()(
  'CertificateChainError',
  { cause: CertificateChainFailure },
) {
}

export class AttestationStatementError extends S.TaggedError<AttestationStatementError>()(
  'AttestationStatementError',
  { cause: AttestationStatementFailure },
) {
}

export class AppDistributionError extends S.TaggedError<AppDistributionError>()(
  'AppDistributionError',
  { cause: AppDistributionFailure },
) {
}

export const AttestationError = S.Union(
  CertificateChainError,
  CertificateRevokedError,
  AttestationStatementError,
  AppDistributionError,
)
export type AttestationError = typeof AttestationError.Type

export namespace VerifyAndroidAttestation {
  export interface Result {
    /** Whether the app was installed from the official Play Store */
    readonly appFromOfficialStore: boolean
  }

  export type VerifyFn = (
    options: {
      readonly expectedPackageNames: ReadonlyArray<PackageName>
      readonly expectedChallenge: AttestationChallenge
      readonly crlEntries: Readonly<Record<string, CrlEntry>>
      readonly knownDigests: {
        readonly playStore: SigningDigestHex
        readonly website: SigningDigestHex
      }
      readonly googleRootPems?: ReadonlyArray<string>
      readonly maxChainLength?: number
      /**
       * base16 (lowercase) verified-boot key fingerprints accepted when a device
       * reports VerifiedBootState.SelfSigned (e.g. GrapheneOS). Defaults to empty,
       * which rejects all SelfSigned devices (OEM-Verified only).
       */
      readonly trustedVerifiedBootKeys?: ReadonlySet<string>
      /** Validation timestamp; defaults to `new Date()` if omitted. */
      readonly now?: Date
    },
  ) => (params: {
    /** Leaf certificate in DER format */
    readonly leafCertDer: ArrayBuffer
    /** Intermediate CA certificates in DER format */
    readonly intermediateCertDers: ReadonlyArray<ArrayBuffer>
  }) => Effect.Effect<Result, AttestationError>
}

/* Stryker disable all */
if (import.meta.vitest) {
  const { ruleOfSchemas } = await import('@identity-backend/testing/schema')
  ruleOfSchemas('PackageName', PackageName)
  ruleOfSchemas('SerialHex', SerialHex)
  ruleOfSchemas('SecurityLevel', SecurityLevel)
  ruleOfSchemas('AttestationChallenge', AttestationChallenge)
  ruleOfSchemas('SigningDigestHex', SigningDigestHex)
}
