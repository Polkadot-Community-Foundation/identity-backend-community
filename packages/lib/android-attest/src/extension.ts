/// <reference types="vitest/importMeta" />
import {
  AttestationApplicationId,
  KeyDescription as LegacyKeyDescription,
  KeyMintKeyDescription,
  NonStandardKeyDescription as LegacyNonStandardKeyDescription,
  NonStandardKeyMintKeyDescription,
  type RootOfTrust,
  type SecurityLevel as AsnSecurityLevel,
  VerifiedBootState,
} from '@peculiar/asn1-android'
import { AsnParser, OctetString } from '@peculiar/asn1-schema'
import { timingSafeEqual } from '@std/crypto/timing-safe-equal'
import { encodeBase64, encodeHex } from '@std/encoding'
import { Either, HashSet, Option, Schema as S } from 'effect'
import type { AttestationChallenge, PackageName } from './attestation.types.js'
import { NO_TRUSTED_VERIFIED_BOOT_KEYS } from './verified-boot-keys.js'

export const ANDROID_ATTESTATION_OID = '1.3.6.1.4.1.11129.2.1.17'

// Verified-boot states whose attestation we honour. Verified (0) is the OEM
// chain of trust; SelfSigned (1) is a user-installed root of trust on a locked
// bootloader (e.g. GrapheneOS, which signs its own OS image). Unverified (2)
// and Failed (3) are rejected.
const ACCEPTED_VERIFIED_BOOT_STATES: ReadonlySet<number> = new Set([
  VerifiedBootState.verified,
  VerifiedBootState.selfSigned,
])

export class AttestationExtensionParseError extends S.TaggedError<AttestationExtensionParseError>()(
  'AttestationExtensionParseError',
  {
    reason: S.String,
  },
) {
}

export class SecurityLevelTooLowError extends S.TaggedError<SecurityLevelTooLowError>()('SecurityLevelTooLowError', {
  securityLevel: S.Number,
}) {
}

export class KeymasterSecurityLevelTooLowError
  extends S.TaggedError<KeymasterSecurityLevelTooLowError>()('KeymasterSecurityLevelTooLowError', {
    securityLevel: S.Number,
  })
{
}

export class MissingRootOfTrustError extends S.TaggedError<MissingRootOfTrustError>()('MissingRootOfTrustError', {}) {
}

export class VerifiedBootStateNotVerifiedError
  extends S.TaggedError<VerifiedBootStateNotVerifiedError>()('VerifiedBootStateNotVerifiedError', {
    state: S.Number,
  })
{
}

export class DeviceNotLockedError extends S.TaggedError<DeviceNotLockedError>()('DeviceNotLockedError', {}) {
}

export class UntrustedVerifiedBootKeyError
  extends S.TaggedError<UntrustedVerifiedBootKeyError>()('UntrustedVerifiedBootKeyError', {
    keyHex: S.String,
  })
{
}

export class ChallengeMismatchError extends S.TaggedError<ChallengeMismatchError>()('ChallengeMismatchError', {
  expected: S.String,
  actual: S.String,
}) {
}

export class PackageNameMismatchError extends S.TaggedError<PackageNameMismatchError>()('PackageNameMismatchError', {
  expected: S.String,
  actual: S.String,
}) {
}

export class ExtensionOnNonLeafError extends S.TaggedError<ExtensionOnNonLeafError>()('ExtensionOnNonLeafError', {
  certIndex: S.Number,
}) {
}

export class NoAttestationExtensionError extends S.TaggedError<NoAttestationExtensionError>()(
  'NoAttestationExtensionError',
  {},
) {
}

export const AttestationStatementFailure = S.Union(
  NoAttestationExtensionError,
  ExtensionOnNonLeafError,
  AttestationExtensionParseError,
  SecurityLevelTooLowError,
  KeymasterSecurityLevelTooLowError,
  MissingRootOfTrustError,
  VerifiedBootStateNotVerifiedError,
  DeviceNotLockedError,
  UntrustedVerifiedBootKeyError,
  ChallengeMismatchError,
  PackageNameMismatchError,
)
export type AttestationStatementFailure = typeof AttestationStatementFailure.Type

export interface ParsedAttestationExtension {
  readonly attestationSecurityLevel: number
  readonly keymasterSecurityLevel: number
  readonly attestationChallenge: Uint8Array
  readonly packageName: string
  readonly signingDigests: ReadonlyArray<Uint8Array>
}

export interface ParsedDescription {
  readonly attestationSecurityLevel: number
  readonly keymasterSecurityLevel: number
  readonly attestationChallenge: Uint8Array
  readonly packageInfos: ReadonlyArray<{ readonly packageName: string }>
  readonly signingDigests: ReadonlyArray<Uint8Array>
  readonly rootOfTrust: RootOfTrust | undefined
}

export const findExtensionCertificate = (
  certs: ReadonlyArray<{ extensions: ReadonlyArray<{ oid: string; value: ArrayBuffer }> }>,
): Either.Either<
  Option.Option<{ readonly certIndex: number; readonly extensionValue: ArrayBuffer }>,
  ExtensionOnNonLeafError
> => {
  for (let i = 1; i < certs.length; i++) {
    const cert = certs[i]
    if (!cert) continue
    for (const ext of cert.extensions) {
      if (ext.oid === ANDROID_ATTESTATION_OID) {
        return Either.left(new ExtensionOnNonLeafError({ certIndex: i }))
      }
    }
  }
  const leaf = certs[0]
  if (!leaf) return Either.right(Option.none())
  for (const ext of leaf.extensions) {
    if (ext.oid === ANDROID_ATTESTATION_OID) {
      return Either.right(Option.some({ certIndex: 0, extensionValue: ext.value }))
    }
  }
  return Either.right(Option.none())
}

const toBytes = (input: Uint8Array | OctetString | ArrayBuffer): Uint8Array => {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(input.buffer)
}

const octetStringToUtf8 = (input: OctetString | ArrayBuffer | string): string => {
  if (typeof input === 'string') return input
  const buf = input instanceof ArrayBuffer ? input : input.buffer
  return new TextDecoder().decode(buf)
}

type AuthorizationListSubset = {
  attestationApplicationId?: OctetString | ArrayBuffer
  rootOfTrust?: RootOfTrust
}

type KeyDescriptionSubset = {
  attestationVersion: number
  attestationSecurityLevel: AsnSecurityLevel | number
  keymasterSecurityLevel?: AsnSecurityLevel | number
  keyMintSecurityLevel?: AsnSecurityLevel | number
  attestationChallenge: OctetString | Uint8Array | ArrayBuffer
  softwareEnforced?: AuthorizationListSubset
  hardwareEnforced?: AuthorizationListSubset
  teeEnforced?: AuthorizationListSubset
}

const decodeApplicationId = (
  appId: OctetString | ArrayBuffer | undefined,
): { packageInfos: ReadonlyArray<{ packageName: string }>; signingDigests: ReadonlyArray<Uint8Array> } => {
  if (!appId) return { packageInfos: [], signingDigests: [] }
  const buf = appId instanceof ArrayBuffer ? appId : appId.buffer
  const parsed = AsnParser.parse(buf, AttestationApplicationId)
  const packageInfos = parsed.packageInfos.map((pkg) => ({
    packageName: octetStringToUtf8(pkg.packageName),
  }))
  const signingDigests = parsed.signatureDigests.map((d) => toBytes(d))
  return { packageInfos, signingDigests }
}

const tryParseDescription = (
  extensionValue: ArrayBuffer,
): Option.Option<ParsedDescription> => {
  const toSubset = (value: unknown): KeyDescriptionSubset =>
    // oxlint-disable-next-line consistent-type-assertions — ASN.1 classes lack index signatures
    value as KeyDescriptionSubset
  const parsers: Array<() => KeyDescriptionSubset> = [
    () => toSubset(AsnParser.parse(extensionValue, KeyMintKeyDescription)),
    () => toSubset(AsnParser.parse(extensionValue, LegacyKeyDescription)),
    () => toSubset(AsnParser.parse(extensionValue, NonStandardKeyMintKeyDescription)),
    () => toSubset(AsnParser.parse(extensionValue, LegacyNonStandardKeyDescription)),
  ]

  for (const parse of parsers) {
    const result = Either.getRight(Either.try(() => normalizeParsedDescription(parse())))
    if (Option.isSome(result)) {
      return result
    }
  }
  return Option.none()
}

const normalizeParsedDescription = (input: KeyDescriptionSubset): ParsedDescription => {
  const attestationSecurityLevel = input.attestationSecurityLevel
  const rawKeyLevel = input.keyMintSecurityLevel ?? input.keymasterSecurityLevel ?? 0
  const keymasterSecurityLevel = rawKeyLevel
  const attestationChallenge = toBytes(input.attestationChallenge)
  const hardwareEnforced = input.hardwareEnforced ?? input.teeEnforced ?? {}
  const rootOfTrust = hardwareEnforced.rootOfTrust
  const attestationApplicationId = input.softwareEnforced?.attestationApplicationId ??
    hardwareEnforced.attestationApplicationId
  const { packageInfos, signingDigests } = decodeApplicationId(attestationApplicationId)

  return {
    attestationSecurityLevel,
    keymasterSecurityLevel,
    attestationChallenge,
    packageInfos,
    signingDigests,
    rootOfTrust,
  }
}

export const validateParsedDescription = (
  parsed: ParsedDescription,
  expectedChallenge: AttestationChallenge,
  expectedPackageNames: ReadonlyArray<PackageName>,
  trustedVerifiedBootKeys: ReadonlySet<string> = NO_TRUSTED_VERIFIED_BOOT_KEYS,
): Either.Either<ParsedAttestationExtension, AttestationStatementFailure> =>
  Either.gen(function*() {
    // FR-004: both the attestation itself and the attested key MUST originate
    // in TEE/StrongBox (SecurityLevel ≥ 1). Either being Software (0) is a fail.
    if (parsed.attestationSecurityLevel < 1) {
      return yield* Either.left(
        new SecurityLevelTooLowError({ securityLevel: parsed.attestationSecurityLevel }),
      )
    }
    if (parsed.keymasterSecurityLevel < 1) {
      return yield* Either.left(
        new KeymasterSecurityLevelTooLowError({ securityLevel: parsed.keymasterSecurityLevel }),
      )
    }

    if (!parsed.rootOfTrust) {
      return yield* Either.left(new MissingRootOfTrustError({}))
    }

    if (!ACCEPTED_VERIFIED_BOOT_STATES.has(parsed.rootOfTrust.verifiedBootState)) {
      return yield* Either.left(
        new VerifiedBootStateNotVerifiedError({ state: parsed.rootOfTrust.verifiedBootState }),
      )
    }
    if (parsed.rootOfTrust.verifiedBootState === VerifiedBootState.selfSigned) {
      const keyHex = encodeHex(toBytes(parsed.rootOfTrust.verifiedBootKey))
      if (!trustedVerifiedBootKeys.has(keyHex)) {
        return yield* Either.left(new UntrustedVerifiedBootKeyError({ keyHex }))
      }
    }
    if (parsed.rootOfTrust.deviceLocked !== true) {
      return yield* Either.left(new DeviceNotLockedError({}))
    }

    const challengeMatch = parsed.attestationChallenge.byteLength === expectedChallenge.byteLength &&
      timingSafeEqual(parsed.attestationChallenge, expectedChallenge)
    if (!challengeMatch) {
      return yield* Either.left(
        new ChallengeMismatchError({
          expected: encodeBase64(expectedChallenge),
          actual: encodeBase64(parsed.attestationChallenge),
        }),
      )
    }

    const expectedSet = HashSet.fromIterable<string>(expectedPackageNames)
    const expectedDisplay = expectedPackageNames.join(',')
    if (parsed.packageInfos.length === 0) {
      return yield* Either.left(
        new PackageNameMismatchError({ expected: expectedDisplay, actual: '' }),
      )
    }

    for (const info of parsed.packageInfos) {
      if (!HashSet.has(expectedSet, info.packageName)) {
        return yield* Either.left(
          new PackageNameMismatchError({ expected: expectedDisplay, actual: info.packageName }),
        )
      }
    }

    return {
      attestationSecurityLevel: parsed.attestationSecurityLevel,
      keymasterSecurityLevel: parsed.keymasterSecurityLevel,
      attestationChallenge: parsed.attestationChallenge,
      packageName: parsed.packageInfos[0]!.packageName,
      signingDigests: parsed.signingDigests,
    }
  })

export const parseAttestationExtension = (
  extensionValue: ArrayBuffer,
  expectedChallenge: AttestationChallenge,
  expectedPackageNames: ReadonlyArray<PackageName>,
  trustedVerifiedBootKeys: ReadonlySet<string> = NO_TRUSTED_VERIFIED_BOOT_KEYS,
): Either.Either<ParsedAttestationExtension, AttestationStatementFailure> =>
  Either.flatMap(
    Either.fromOption(() => new AttestationExtensionParseError({ reason: 'All ASN.1 parsers failed' }))(
      tryParseDescription(extensionValue),
    ),
    (parsed) => validateParsedDescription(parsed, expectedChallenge, expectedPackageNames, trustedVerifiedBootKeys),
  )

// Stryker disable all
if (import.meta.vitest) {
  const { describe } = await import('@effect/vitest')
  describe('Rule of Schemas', () => {})
}
