import { Clock, Effect, Either, Option } from 'effect'
import {
  AppDistributionError,
  AttestationStatementError,
  CertificateChainError,
  type VerifyAndroidAttestation,
} from './attestation.types.js'
import { verifyCertificateChain } from './certificates.js'
import { CertificateRevokedError, isSerialRevoked } from './crl.js'
import { determineDistributionChannel } from './distribution.js'
import { findExtensionCertificate, NoAttestationExtensionError, parseAttestationExtension } from './extension.js'
import { GOOGLE_ROOT_CERTS } from './roots.js'
import { NO_TRUSTED_VERIFIED_BOOT_KEYS } from './verified-boot-keys.js'

const DEFAULT_MAX_CHAIN_LENGTH = 10

export const verifyAndroidAttestation: VerifyAndroidAttestation.VerifyFn = (options) => (params) =>
  Effect.gen(function*() {
    const rootPems = options.googleRootPems ?? GOOGLE_ROOT_CERTS
    const maxLen = options.maxChainLength ?? DEFAULT_MAX_CHAIN_LENGTH
    const now = options.now ?? new Date(yield* Clock.currentTimeMillis)

    const verified = yield* verifyCertificateChain(
      params.leafCertDer,
      params.intermediateCertDers,
      rootPems,
      maxLen,
      now,
    ).pipe(Effect.mapError((cause) => new CertificateChainError({ cause })))

    const chainCerts = [verified.leaf, ...verified.intermediates, verified.root]
    for (let i = 0; i < chainCerts.length; i++) {
      const serialHex = chainCerts[i]!.serialNumber
      if (isSerialRevoked(serialHex, options.crlEntries)) {
        return yield* Effect.fail(new CertificateRevokedError({ serialHex, position: i }))
      }
    }

    const toExtList = (cert: typeof verified.leaf) => ({
      extensions: cert.extensions.map((ext) => ({
        oid: ext.type,
        value: ext.value,
      })),
    })
    const certExts = [
      toExtList(verified.leaf),
      ...verified.intermediates.map(toExtList),
      toExtList(verified.root),
    ]

    const foundEither = findExtensionCertificate(certExts)
    const foundOption = yield* Either.mapLeft(foundEither, (cause) => new AttestationStatementError({ cause }))
    if (Option.isNone(foundOption)) {
      return yield* Effect.fail(new AttestationStatementError({ cause: new NoAttestationExtensionError({}) }))
    }

    const parsed = yield* Either.mapLeft(
      parseAttestationExtension(
        foundOption.value.extensionValue,
        options.expectedChallenge,
        options.expectedPackageNames,
        options.trustedVerifiedBootKeys ?? NO_TRUSTED_VERIFIED_BOOT_KEYS,
      ),
      (cause) => new AttestationStatementError({ cause }),
    )

    const distribution = yield* Either.mapLeft(
      determineDistributionChannel(parsed.signingDigests, options.knownDigests),
      (cause) => new AppDistributionError({ cause }),
    )

    return {
      appFromOfficialStore: distribution.appFromOfficialStore,
    } satisfies VerifyAndroidAttestation.Result
  })
