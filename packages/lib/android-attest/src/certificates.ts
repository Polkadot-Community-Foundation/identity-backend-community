/// <reference types="vitest/importMeta" />
import { KeyUsageFlags, KeyUsagesExtension, X509Certificate } from '@peculiar/x509'
import { Brand, Effect, Either, Schema as S } from 'effect'
import { GOOGLE_ROOT_CERTS } from './roots.js'

export class ChainVerificationFailedError extends S.TaggedError<ChainVerificationFailedError>()(
  'ChainVerificationFailedError',
  {
    detail: S.String,
  },
) {
}

export class RootNotTrustedError extends S.TaggedError<RootNotTrustedError>()('RootNotTrustedError', {}) {
}

export class ChainTooLongError extends S.TaggedError<ChainTooLongError>()('ChainTooLongError', {
  length: S.Number.pipe(S.nonNaN()),
  max: S.Number.pipe(S.nonNaN()),
}) {
}

export class InvalidDnChainError extends S.TaggedError<InvalidDnChainError>()('InvalidDnChainError', {
  position: S.Number.pipe(S.nonNaN()),
  detail: S.String,
}) {
}

export class KeyUsageViolationError extends S.TaggedError<KeyUsageViolationError>()('KeyUsageViolationError', {
  position: S.Number.pipe(S.nonNaN()),
  detail: S.String,
}) {
}

export class CertificateNotYetValidError extends S.TaggedError<CertificateNotYetValidError>()(
  'CertificateNotYetValidError',
  {
    position: S.Number.pipe(S.nonNaN()),
    notBefore: S.Date,
  },
) {
}

export class CertificateExpiredError extends S.TaggedError<CertificateExpiredError>()(
  'CertificateExpiredError',
  {
    position: S.Number.pipe(S.nonNaN()),
    notAfter: S.Date,
  },
) {
}

export const CertificateChainFailure = S.Union(
  ChainVerificationFailedError,
  RootNotTrustedError,
  ChainTooLongError,
  InvalidDnChainError,
  KeyUsageViolationError,
  CertificateNotYetValidError,
  CertificateExpiredError,
)
export type CertificateChainFailure = typeof CertificateChainFailure.Type

export interface SubjectAndIssuer {
  readonly subject: string
  readonly issuer: string
}

export const determineDirection = (
  certs: ReadonlyArray<SubjectAndIssuer>,
): 'leaf-to-root' | 'root-to-leaf' => {
  if (certs.length === 0) return 'leaf-to-root'
  if (certs[0]!.subject === certs[0]!.issuer) return 'root-to-leaf'
  return 'leaf-to-root'
}

export const validateDnChainOrder = <T extends SubjectAndIssuer>(
  ordered: ReadonlyArray<T>,
): Either.Either<ReadonlyArray<T>, InvalidDnChainError> => {
  for (let i = 0; i < ordered.length - 1; i++) {
    if (ordered[i]!.issuer !== ordered[i + 1]!.subject) {
      return Either.left(
        new InvalidDnChainError({
          position: i,
          detail: `Certificate at position ${i} issuer "${ordered[i]!.issuer}" does not match certificate at position ${
            i + 1
          } subject "${ordered[i + 1]!.subject}"`,
        }),
      )
    }
  }
  return Either.right(ordered)
}

export const validateValidityWindow = (
  ordered: ReadonlyArray<X509Certificate>,
  now: Date,
): Either.Either<ReadonlyArray<X509Certificate>, CertificateNotYetValidError | CertificateExpiredError> => {
  const t = now.getTime()
  for (let i = 0; i < ordered.length; i++) {
    const cert = ordered[i]!
    if (cert.notBefore.getTime() > t) {
      return Either.left(new CertificateNotYetValidError({ position: i, notBefore: cert.notBefore }))
    }
    if (cert.notAfter.getTime() < t) {
      return Either.left(new CertificateExpiredError({ position: i, notAfter: cert.notAfter }))
    }
  }
  return Either.right(ordered)
}

export const validateKeyUsages = (
  ordered: ReadonlyArray<X509Certificate>,
): Either.Either<ReadonlyArray<X509Certificate>, KeyUsageViolationError> => {
  for (let i = 0; i < ordered.length; i++) {
    const isLeaf = i === 0
    const isIntermediateCa = i > 0 && i < ordered.length - 1
    const cert = ordered[i]!
    const keyUsageExt = cert.getExtension<KeyUsagesExtension>('2.5.29.15')
    if (isIntermediateCa && keyUsageExt && !(keyUsageExt.usages & KeyUsageFlags.keyCertSign)) {
      return Either.left(
        new KeyUsageViolationError({
          position: i,
          detail: `Intermediate certificate at position ${i} missing keyCertSign key usage`,
        }),
      )
    }
    if (isLeaf && keyUsageExt && !(keyUsageExt.usages & KeyUsageFlags.digitalSignature)) {
      return Either.left(
        new KeyUsageViolationError({
          position: i,
          detail: `Leaf certificate at position ${i} missing digitalSignature key usage`,
        }),
      )
    }
  }
  return Either.right(ordered)
}

export interface VerifiedChain {
  readonly leaf: X509Certificate
  readonly intermediates: ReadonlyArray<X509Certificate>
  readonly root: X509Certificate
  readonly rootPem: string
}

export { GOOGLE_ROOT_CERTS }

export type OrderedCertificateChain = ReadonlyArray<X509Certificate> & Brand.Brand<'OrderedCertificateChain'>
const OrderedCertificateChain = Brand.nominal<OrderedCertificateChain>()

export const orderCertificateChain = (
  certs: ReadonlyArray<X509Certificate>,
): Either.Either<OrderedCertificateChain, InvalidDnChainError> => {
  const direction = determineDirection(certs)
  const ordered = direction === 'root-to-leaf' ? [...certs].reverse() : certs
  return Either.map(validateDnChainOrder(ordered), OrderedCertificateChain)
}

export const prepareCertificateChain = (
  leafDer: ArrayBuffer,
  intermediateDers: ReadonlyArray<ArrayBuffer>,
  maxChainLength: number,
  now: Date,
): Either.Either<OrderedCertificateChain, CertificateChainFailure> =>
  Either.gen(function*() {
    const total = 1 + intermediateDers.length
    if (total > maxChainLength) {
      return yield* Either.left(new ChainTooLongError({ length: total, max: maxChainLength }))
    }

    const leaf = yield* Either.try({
      try: () => new X509Certificate(leafDer),
      catch: () => new ChainVerificationFailedError({ detail: 'Failed to parse leaf certificate' }),
    })

    const intermediates = yield* Either.all(
      intermediateDers.map((der) =>
        Either.try({
          try: () => new X509Certificate(der),
          catch: () => new ChainVerificationFailedError({ detail: 'Failed to parse intermediate certificate' }),
        })
      ),
    )

    const ordered = yield* orderCertificateChain([leaf, ...intermediates])
    yield* validateValidityWindow(ordered, now)
    yield* validateKeyUsages(ordered)

    return ordered
  })

const verifyAgainst = (cert: X509Certificate, issuer: X509Certificate): Effect.Effect<boolean> =>
  Effect.tryPromise(() => cert.verify({ publicKey: issuer, signatureOnly: true })).pipe(
    Effect.orElseSucceed(() => false),
  )

const matchesRoot = (chainRoot: X509Certificate, rootPem: string): Effect.Effect<boolean> =>
  Either.match(Either.try(() => new X509Certificate(rootPem)), {
    onLeft: () => Effect.succeed(false),
    onRight: (googleRoot) => verifyAgainst(chainRoot, googleRoot),
  })

export const verifyCertificateChain = (
  leafDer: ArrayBuffer,
  intermediateDers: ReadonlyArray<ArrayBuffer>,
  googleRootPems: ReadonlyArray<string>,
  maxChainLength: number,
  now: Date,
): Effect.Effect<VerifiedChain, CertificateChainFailure> =>
  Effect.gen(function*() {
    const ordered = yield* prepareCertificateChain(leafDer, intermediateDers, maxChainLength, now)

    for (let i = 0; i < ordered.length - 1; i++) {
      const ok = yield* verifyAgainst(ordered[i]!, ordered[i + 1]!)
      if (!ok) {
        return yield* Effect.fail(
          new ChainVerificationFailedError({ detail: `Certificate at position ${i} failed signature verification` }),
        )
      }
    }

    const chainRoot = ordered[ordered.length - 1]!
    let matchedRootPem = ''
    for (const pem of googleRootPems) {
      if (yield* matchesRoot(chainRoot, pem)) {
        matchedRootPem = pem
        break
      }
    }

    if (matchedRootPem === '') {
      return yield* Effect.fail(new RootNotTrustedError({}))
    }

    return {
      leaf: ordered[0]!,
      intermediates: ordered.slice(1, -1),
      root: chainRoot,
      rootPem: matchedRootPem,
    }
  })

// Stryker disable all
if (import.meta.vitest) {
  const { describe } = await import('@effect/vitest')
  describe('Rule of Schemas', () => {})
}
