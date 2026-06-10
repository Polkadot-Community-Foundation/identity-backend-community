/**
 * @see {@link https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server#Verify-the-assertion}
 */

import { p256 } from '@noble/curves/nist.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { equals as equalsBytes } from '@std/bytes'
import { decodeCbor } from '@std/cbor'
import { Effect, pipe, Schema as S } from 'effect'
import { Assertion, DecodeAssertionError, type VerifyAssertion, VerifyAssertionError } from './assertion.types.js'
import { concatBytesSync, toArrayBuffer } from './utils.js'

const textEncoder = new TextEncoder()

const decodeAssertion = (assertion: Uint8Array): Effect.Effect<Assertion, DecodeAssertionError, never> =>
  pipe(
    Effect.try({
      try: () => decodeCbor(assertion),
      catch: (err) => new DecodeAssertionError({ cause: err }),
    }),
    Effect.andThen(S.decodeUnknown(Assertion)),
    Effect.catchTag('ParseError', (err) => new DecodeAssertionError({ cause: err })),
  )

export const verifyAssertion: VerifyAssertion = (options) => (params) =>
  Effect.gen(function*() {
    const crypto = options.crypto ?? globalThis.crypto

    const assertion = yield* decodeAssertion(params.assertion)
    const clientDataHash = yield* options.buildClientDataHash(
      {
        payload: params.clientData,
        challenge: params.challenge,
        clientId: params.clientId,
      },
      {
        crypto,
      },
    )
    const nonce = yield* Effect.sync(() => sha256(concatBytesSync([assertion.authenticatorData, clientDataHash])))
    const nonceBuffer = toArrayBuffer(nonce)

    // https://stackoverflow.com/questions/78064757/how-verify-public-key-with-web-crypto-api
    const rawSignatureBytes = yield* Effect.sync(() => p256.Signature.fromBytes(assertion.signature, 'der').toBytes())
    const rawSignature = toArrayBuffer(rawSignatureBytes)

    const isSignatureValid = yield* Effect.promise(() =>
      crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        params.publicKey,
        rawSignature,
        nonceBuffer,
      )
    )

    if (!isSignatureValid) {
      return yield* new VerifyAssertionError({ message: `Assertion signature is invalid` })
    }

    const hasMatchingAppId = yield* Effect.gen(function*() {
      const rpIdHash = assertion.authenticatorData.slice(0, 32)

      for (const appId of options.appIds) {
        const appIdHash = yield* Effect.sync(() => sha256(textEncoder.encode(appId)))
        if (equalsBytes(appIdHash, rpIdHash)) {
          return true
        }
      }
      return false
    })

    if (!hasMatchingAppId) {
      return yield* new VerifyAssertionError({
        message: "None of the configured app IDs match the authenticator data's RP ID hash",
      })
    }

    const authData = assertion.authenticatorData
    const authDataBuffer = authData.buffer.slice(authData.byteOffset, authData.byteOffset + authData.byteLength)
    const nextSignCount = new DataView(authDataBuffer).getUint32(33)

    if (nextSignCount <= params.signCount) {
      return yield* new VerifyAssertionError({
        message: `Invalid sign count: ${nextSignCount}. Expected a value greater than ${params.signCount}`,
      })
    }

    return nextSignCount
  })

export * from './assertion.types.js'
