export { verifyAndroidAttestation } from './attestation.js'

export {
  AppDistributionError,
  AttestationChallenge,
  AttestationError,
  AttestationStatementError,
  CertificateChainError,
  PackageName,
  SecurityLevel,
  SerialHex,
  SigningDigestHex,
} from './attestation.types.js'
export type { VerifyAndroidAttestation } from './attestation.types.js'

export { CertificateChainFailure } from './certificates.js'
export { AppDistributionFailure } from './distribution.js'
export { AttestationStatementFailure } from './extension.js'

export {
  CertificateRevokedError,
  CrlResponseFromJson,
  FetchCrlError,
  normalizeCrlEntries,
  ParseCrlError,
} from './crl.js'
export type { CrlEntry, CrlResponse } from './crl.js'

export { GRAPHENEOS_VERIFIED_BOOT_KEY_FINGERPRINTS, GRAPHENEOS_VERIFIED_BOOT_KEYS } from './verified-boot-keys.js'
