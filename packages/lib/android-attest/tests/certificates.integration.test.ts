import { describe, expect, it } from '@effect/vitest'
import { BasicConstraintsExtension, KeyUsageFlags, KeyUsagesExtension, X509CertificateGenerator } from '@peculiar/x509'
import { Clock, Duration, Effect, Either, TestClock } from 'effect'
import {
  CertificateExpiredError,
  CertificateNotYetValidError,
  ChainTooLongError,
  ChainVerificationFailedError,
  determineDirection,
  InvalidDnChainError,
  RootNotTrustedError,
  validateValidityWindow,
  verifyCertificateChain,
} from '../src/certificates.js'

const BASE_TIME_MS = Date.UTC(2024, 0, 1)
const advanceToBase = TestClock.adjust(Duration.millis(BASE_TIME_MS))

async function generateTestChain(now: Date, opts?: { leafNotBefore?: Date; leafNotAfter?: Date }) {
  const rootKey = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['sign', 'verify'],
  )
  const rootCert = await X509CertificateGenerator.create({
    serialNumber: '01',
    subject: 'CN=Test Root CA',
    issuer: 'CN=Test Root CA',
    notBefore: now,
    notAfter: new Date(now.getTime() + 365 * 86400_000),
    signingKey: rootKey.privateKey,
    publicKey: rootKey.publicKey,
    extensions: [
      new BasicConstraintsExtension(true, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    ],
  })

  const intKey = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['sign', 'verify'],
  )
  const intCert = await X509CertificateGenerator.create({
    serialNumber: '02',
    subject: 'CN=Test Intermediate CA',
    issuer: rootCert.subject,
    notBefore: now,
    notAfter: new Date(now.getTime() + 365 * 86400_000),
    signingKey: rootKey.privateKey,
    publicKey: intKey.publicKey,
    extensions: [
      new BasicConstraintsExtension(true, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    ],
  })

  const leafKey = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['sign', 'verify'],
  )
  const leafCert = await X509CertificateGenerator.create({
    serialNumber: '03',
    subject: 'CN=test.example.com',
    issuer: intCert.subject,
    notBefore: opts?.leafNotBefore ?? now,
    notAfter: opts?.leafNotAfter ?? new Date(now.getTime() + 86400_000),
    signingKey: intKey.privateKey,
    publicKey: leafKey.publicKey,
    extensions: [
      new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
    ],
  })

  return { leafCert, intCert, rootCert, rootPem: rootCert.toString() }
}

describe('determineDirection', () => {
  it('Should_ReturnRootToLeaf_When_FirstCertIsSelfSigned', () => {
    expect(determineDirection([{ subject: 'CN=root', issuer: 'CN=root' }])).toBe('root-to-leaf')
  })

  it('Should_ReturnLeafToRoot_When_FirstCertHasDifferentSubjectAndIssuer', () => {
    expect(determineDirection([{ subject: 'CN=leaf', issuer: 'CN=intermediate' }])).toBe('leaf-to-root')
  })

  it('Should_ReturnLeafToRoot_When_ArrayIsEmpty', () => {
    expect(determineDirection([])).toBe('leaf-to-root')
  })
})

describe('validateValidityWindow', () => {
  it.effect('Should_ReturnNotYetValid_When_NowIsBeforeLeafNotBefore', () =>
    Effect.gen(function*() {
      yield* advanceToBase
      const now = new Date(yield* Clock.currentTimeMillis)
      const futureStart = new Date(now.getTime() + 86400_000)
      const { leafCert, intCert, rootCert } = yield* Effect.promise(() =>
        generateTestChain(now, {
          leafNotBefore: futureStart,
          leafNotAfter: new Date(now.getTime() + 2 * 86400_000),
        })
      )
      const result = validateValidityWindow([leafCert, intCert, rootCert], now)
      expect(result).toEqual(
        Either.left(new CertificateNotYetValidError({ position: 0, notBefore: leafCert.notBefore })),
      )
    }))

  it.effect('Should_ReturnExpired_When_NowIsAfterLeafNotAfter', () =>
    Effect.gen(function*() {
      yield* advanceToBase
      const now = new Date(yield* Clock.currentTimeMillis)
      const pastStart = new Date(now.getTime() - 2 * 86400_000)
      const pastEnd = new Date(now.getTime() - 86400_000)
      const { leafCert, intCert, rootCert } = yield* Effect.promise(() =>
        generateTestChain(now, {
          leafNotBefore: pastStart,
          leafNotAfter: pastEnd,
        })
      )
      const result = validateValidityWindow([leafCert, intCert, rootCert], now)
      expect(result).toEqual(
        Either.left(new CertificateExpiredError({ position: 0, notAfter: leafCert.notAfter })),
      )
    }))

  it.effect('Should_ReturnRight_When_AllCertsWithinValidityWindow', () =>
    Effect.gen(function*() {
      yield* advanceToBase
      const now = new Date(yield* Clock.currentTimeMillis)
      const { leafCert, intCert, rootCert } = yield* Effect.promise(() => generateTestChain(now))
      const input = [leafCert, intCert, rootCert] as const
      const result = validateValidityWindow(input, now)
      expect(result).toEqual(Either.right(input))
    }))
})

describe('verifyCertificateChain', () => {
  it.effect('Should_ReturnChainTooLong_When_ChainExceedsMaxLength', () =>
    Effect.gen(function*() {
      yield* advanceToBase
      const now = new Date(yield* Clock.currentTimeMillis)
      const result = yield* Effect.either(
        verifyCertificateChain(
          new ArrayBuffer(8),
          Array.from({ length: 10 }, () => new ArrayBuffer(8)),
          ['pem1'],
          5,
          now,
        ),
      )
      expect(result).toEqual(Either.left(new ChainTooLongError({ length: 11, max: 5 })))
    }))

  it.effect('Should_ReturnChainVerificationFailed_When_LeafDerIsInvalid', () =>
    Effect.gen(function*() {
      yield* advanceToBase
      const now = new Date(yield* Clock.currentTimeMillis)
      const result = yield* Effect.either(
        verifyCertificateChain(new Uint8Array([0, 1, 2]).buffer, [], ['pem1'], 10, now),
      )
      expect(result).toEqual(
        Either.left(new ChainVerificationFailedError({ detail: 'Failed to parse leaf certificate' })),
      )
    }))

  it.effect('Should_ReturnChainVerificationFailed_When_IntermediateDerIsInvalid', () =>
    Effect.gen(function*() {
      yield* advanceToBase
      const now = new Date(yield* Clock.currentTimeMillis)
      const { leafCert, rootPem } = yield* Effect.promise(() => generateTestChain(now))
      const result = yield* Effect.either(
        verifyCertificateChain(
          leafCert.rawData,
          [new Uint8Array([0, 1, 2]).buffer],
          [rootPem],
          10,
          now,
        ),
      )
      expect(result).toEqual(
        Either.left(new ChainVerificationFailedError({ detail: 'Failed to parse intermediate certificate' })),
      )
    }))

  it.effect('Should_ReturnInvalidDnChain_When_LeafIssuerDoesNotMatch', () =>
    Effect.gen(function*() {
      yield* advanceToBase
      const now = new Date(yield* Clock.currentTimeMillis)
      const { intCert, rootPem } = yield* Effect.promise(() => generateTestChain(now))
      const badKey = yield* Effect.promise(() =>
        crypto.subtle.generateKey(
          { name: 'ECDSA', namedCurve: 'P-384' },
          true,
          ['sign', 'verify'],
        )
      )
      const rogueLeaf = yield* Effect.promise(() =>
        X509CertificateGenerator.create({
          serialNumber: '99',
          subject: 'CN=rogue.example.com',
          issuer: 'CN=Nonexistent CA',
          notBefore: now,
          notAfter: new Date(now.getTime() + 86400_000),
          signingKey: badKey.privateKey,
          publicKey: badKey.publicKey,
          extensions: [new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true)],
        })
      )
      const result = yield* Effect.either(
        verifyCertificateChain(rogueLeaf.rawData, [intCert.rawData], [rootPem], 10, now),
      )
      expect(Either.isLeft(result) && result.left).toBeInstanceOf(InvalidDnChainError)
    }))

  it.effect('Should_ReturnExpired_When_LeafIsExpired', () =>
    Effect.gen(function*() {
      yield* advanceToBase
      const now = new Date(yield* Clock.currentTimeMillis)
      const past = new Date(now.getTime() - 2 * 86400_000)
      const justBefore = new Date(now.getTime() - 86400_000)
      const { leafCert, intCert, rootPem } = yield* Effect.promise(() =>
        generateTestChain(now, {
          leafNotBefore: past,
          leafNotAfter: justBefore,
        })
      )
      const result = yield* Effect.either(
        verifyCertificateChain(leafCert.rawData, [intCert.rawData], [rootPem], 10, now),
      )
      expect(Either.isLeft(result) && result.left).toBeInstanceOf(CertificateExpiredError)
    }))

  it.effect('Should_ReturnRootNotTrusted_When_NoRootMatches', () =>
    Effect.gen(function*() {
      yield* advanceToBase
      const now = new Date(yield* Clock.currentTimeMillis)
      const { leafCert, intCert } = yield* Effect.promise(() => generateTestChain(now))
      const result = yield* Effect.either(
        verifyCertificateChain(leafCert.rawData, [intCert.rawData], ['not-a-real-pem'], 10, now),
      )
      expect(Either.isLeft(result) && result.left).toBeInstanceOf(RootNotTrustedError)
    }))

  it.effect('Should_ReturnRight_When_ChainIsValid', () =>
    Effect.gen(function*() {
      yield* advanceToBase
      const now = new Date(yield* Clock.currentTimeMillis)
      const { leafCert, intCert, rootPem } = yield* Effect.promise(() => generateTestChain(now))
      const result = yield* Effect.either(
        verifyCertificateChain(leafCert.rawData, [intCert.rawData], [rootPem], 10, now),
      )
      // With a 2-cert client chain the topmost client cert (intCert) is the
      // anchor; the Google root is matched by signature but not folded in.
      expect(result).toEqual(Either.right({ leaf: leafCert, intermediates: [], root: intCert, rootPem }))
    }))
})
