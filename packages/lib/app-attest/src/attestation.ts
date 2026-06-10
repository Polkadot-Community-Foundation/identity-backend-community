/**
 * @see {@link https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server}
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { X509Certificate } from '@peculiar/x509'
import { equals as equalsBytes } from '@std/bytes'
import { decodeCbor } from '@std/cbor'
import { encodeHex } from '@std/encoding'
import { Clock, Effect, pipe, Schema as S, Tuple } from 'effect'
import { RuntimeException, UnknownException } from 'effect/Cause'
import {
  Attestation,
  type DecodeAttestation,
  DecodeAttestationError,
  type VerifyAttestation,
  VerifyAttestationError,
} from './attestation.types.js'
import { APPLE_APP_ATTESTATION_ROOT_CA } from './certificates.js'
import { APPLE_APP_ATTEST_OID, DEV_AAGUID, PROD_AAGUID } from './constants.js'
import { concatBytes, toArrayBuffer } from './utils.js'

const textEncoder = new TextEncoder()

/**
 * @internal
 */
const decodeAttestation: DecodeAttestation = Effect.fn('apple_attest/decode_attestation')(
  (attestation) =>
    pipe(
      Effect.try({
        try: () => decodeCbor(attestation),
        catch: (err) => new DecodeAttestationError({ cause: new UnknownException(err) }),
      }),
      Effect.andThen(S.decodeUnknown(Attestation)),
      Effect.catchTag('ParseError', (err) => new DecodeAttestationError({ cause: err })),
    ),
)

/**
 * @internal
 */
const parseCertificates = Effect.fn('apple_attest/parse_certificates')(
  (certs: readonly [Uint8Array, Uint8Array]) =>
    pipe(
      Tuple.map(
        certs,
        (uint8Array) =>
          Effect.try(() => {
            return new X509Certificate(toArrayBuffer(uint8Array))
          }),
      ),
      Effect.all,
      Effect.map(([credCert, intermediateCert]) => ({ credCert, intermediateCert })),
    ),
)

const verifyAttestation: VerifyAttestation = (options) => ({ attestation: attestationBytes, challenge, keyId }) => {
  return Effect.gen(function*() {
    const crypto = options.crypto ?? globalThis.crypto
    const date = yield* (options.now ?? Effect.succeed(new Date(yield* Clock.currentTimeMillis)))

    const attestation = yield* decodeAttestation(attestationBytes)
    const rootCert = yield* Effect.sync(() => new X509Certificate(options.rootCert ?? APPLE_APP_ATTESTATION_ROOT_CA))
    const { credCert, intermediateCert } = yield* parseCertificates(attestation.attStmt.x5c)

    const credCertVerified = yield* Effect.promise(() =>
      credCert.verify({ publicKey: intermediateCert.publicKey, date })
    )
    if (!credCertVerified) {
      // Stryker disable all
      /* v8 ignore next */
      yield* Effect.logDebug('Cred certificate verification failed')
      // Stryker enable all
      return yield* Effect.fail(new RuntimeException('Cred certificate is not verified'))
    }

    const intermediateCertVerified = yield* Effect.promise(() =>
      intermediateCert.verify({ publicKey: rootCert.publicKey, date })
    )
    if (!intermediateCertVerified) {
      // Stryker disable all
      /* v8 ignore next */
      yield* Effect.logDebug('Intermediate certificate verification failed')
      // Stryker enable all
      return yield* Effect.fail(new RuntimeException('Intermediate certificate is not verified'))
    }

    const challengeHash = yield* Effect.sync(() => sha256(new Uint8Array(toArrayBuffer(challenge))))
    const clientDataHash = yield* concatBytes([attestation.authData, challengeHash])
    const nonce = yield* Effect.sync(() => sha256(clientDataHash))

    const extension = yield* Effect.sync(() => credCert.getExtension(APPLE_APP_ATTEST_OID))
    if (!extension) {
      // Stryker disable all
      /* v8 ignore next */
      yield* Effect.logDebug(`Extension not found`, { oid: APPLE_APP_ATTEST_OID })
      // Stryker enable all
      return yield* Effect.fail(
        new RuntimeException(`Extension ${APPLE_APP_ATTEST_OID} not found in credential certificate`),
      )
    }

    const fullExpectedNonce = yield* pipe(
      Effect.try(() => extension.value),
      Effect.map((s) => new Uint8Array(s)),
    )

    const expectedNonce = fullExpectedNonce.slice(-32)
    if (!equalsBytes(nonce, expectedNonce)) {
      // Stryker disable all
      /* v8 ignore next */
      yield* Effect.logDebug('Nonce mismatch', {
        expected: encodeHex(expectedNonce),
        actual: encodeHex(nonce),
      })
      // Stryker enable all
      return yield* Effect.fail(
        new RuntimeException('Nonce in certificate extension does not match the expected nonce'),
      )
    }

    const publicKeyHash = yield* Effect.sync(() => sha256(new Uint8Array(credCert.publicKey.rawData.slice(-65))))
    if (!equalsBytes(keyId, publicKeyHash)) {
      // Stryker disable all
      /* v8 ignore next */
      yield* Effect.logDebug('Key ID mismatch', {
        expected: encodeHex(publicKeyHash),
        actual: encodeHex(keyId),
      })
      // Stryker enable all
      return yield* Effect.fail(new RuntimeException('Public key hash does not match the provided key identifier'))
    }

    const rpIdHash = attestation.authData.slice(0, 32)
    // Stryker disable all
    /* v8 ignore next */
    yield* Effect.annotateLogsScoped({
      rpIdHash: encodeHex(rpIdHash),
      configuredAppIds: options.appIds,
    })
    // Stryker enable all

    const hasMatchingAppId = yield* Effect.gen(function*() {
      for (const appId of options.appIds) {
        const appIdHash = yield* Effect.sync(() => sha256(textEncoder.encode(appId)))

        // Stryker disable all
        /* v8 ignore next */
        yield* Effect.annotateLogsScoped({
          appId,
          appIdHash: encodeHex(appIdHash),
          isMatch: equalsBytes(appIdHash, rpIdHash),
        })
        // Stryker enable all

        if (equalsBytes(appIdHash, rpIdHash)) {
          return true
        }
      }
      return false
    })

    if (!hasMatchingAppId) {
      // Stryker disable all
      /* v8 ignore next */
      yield* Effect.logDebug('No matching app ID found')
      // Stryker enable all
      return yield* Effect.fail(
        new RuntimeException(
          "None of the configured app IDs match the authenticator data's RP ID hash",
        ),
      )
    }

    const { authData } = attestation
    const authDataBuffer = authData.buffer.slice(authData.byteOffset, authData.byteOffset + authData.byteLength)
    const counterField = new DataView(authDataBuffer).getUint32(33)

    if (counterField !== 0) {
      // Stryker disable all
      /* v8 ignore next */
      yield* Effect.logDebug('Counter field is not 0', { counterField })
      // Stryker enable all
      return yield* Effect.fail(new RuntimeException("Authenticator data's counter field is not 0"))
    }

    const aaguid = new Uint8Array(authDataBuffer.slice(37, 53))
    if (!equalsBytes(aaguid, DEV_AAGUID) && !equalsBytes(aaguid, PROD_AAGUID)) {
      // Stryker disable all
      /* v8 ignore next */
      yield* Effect.logDebug('AAGUID mismatch', {
        actual: encodeHex(aaguid),
        devExpected: encodeHex(DEV_AAGUID),
        prodExpected: encodeHex(PROD_AAGUID),
      })
      // Stryker enable all
      return yield* Effect.fail(
        new RuntimeException('AAGUID does not match expected values for development or production'),
      )
    }

    const credentialIdLength = new DataView(authDataBuffer).getUint16(53)
    const credentialId = new Uint8Array(authDataBuffer.slice(55, 55 + credentialIdLength))

    if (!equalsBytes(credentialId, keyId)) {
      // Stryker disable all
      /* v8 ignore next */
      yield* Effect.logDebug('Credential ID does not match key identifier', {
        credentialId: encodeHex(credentialId),
        keyId: encodeHex(keyId),
      })
      // Stryker enable all
      return yield* Effect.fail(new RuntimeException('Credential ID does not match the provided key identifier'))
    }

    const publicKey = yield* Effect.promise(() => credCert.publicKey.export(crypto)).pipe(
      Effect.andThen((key) => Effect.promise(() => crypto.subtle.exportKey('spki', key))),
      Effect.map((ab) => new Uint8Array(ab)),
    )

    return {
      publicKey,
      receipt: attestation.attStmt.receipt,
    } satisfies VerifyAttestation.Result as VerifyAttestation.Result
  }).pipe(
    Effect.mapError((cause) => new VerifyAttestationError({ cause })),
    Effect.scoped,
  )
}

export * from './attestation.types.js'
export { verifyAttestation }
