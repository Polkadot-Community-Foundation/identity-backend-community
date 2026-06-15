import { ChallengeRejectedError, KeyId } from '@identity-backend/auth/services'
import { Context, Effect, Either, Runtime, Schema as S } from 'effect'
import { createMiddleware } from 'hono/factory'
import { AppAttestError, AppAttestMiddlewareError } from './types.js'

export namespace AppAttestMiddlewareConfig {
  export type isPackageNameValid = (_: string) => Effect.Effect<boolean>
  export type ConsumeChallenge = (_: Uint8Array) => Effect.Effect<void, ChallengeRejectedError>

  export interface GetAssertionResult {
    readonly attestation: { publicKey: string; signCount: number }
    readonly publicKey: CryptoKey
  }

  interface GetAssertionParams {
    readonly keyId: KeyId
  }

  export type GetAssertion = (params: GetAssertionParams) => Effect.Effect<GetAssertionResult, AppAttestError>

  export interface VerifyAssertionResult {
    readonly publicKey: CryptoKey
    readonly nextSignCount: number
  }

  interface VerifyAssertionParams {
    readonly attestation: { publicKey: string; signCount: number }
    readonly publicKey: CryptoKey
    readonly clientData: Uint8Array
    readonly assertion: Uint8Array
    readonly challenge: Uint8Array
    readonly clientId: Uint8Array
  }

  export type VerifyAssertion = (params: VerifyAssertionParams) => Effect.Effect<VerifyAssertionResult, AppAttestError>

  interface CommitAssertionParams {
    readonly keyId: KeyId
    readonly nextSignCount: number
  }

  export type CommitAssertion = (params: CommitAssertionParams) => Effect.Effect<void, AppAttestError>
}

export class AppAttestMiddlewareConfig extends Context.Tag('@app/AppAttestMiddlewareConfig')<
  AppAttestMiddlewareConfig,
  {
    readonly isPackageNameValid: AppAttestMiddlewareConfig.isPackageNameValid
    readonly consumeChallenge: AppAttestMiddlewareConfig.ConsumeChallenge
    readonly getAssertion: AppAttestMiddlewareConfig.GetAssertion
    readonly verifyAssertion: AppAttestMiddlewareConfig.VerifyAssertion
    readonly commitAssertion: AppAttestMiddlewareConfig.CommitAssertion
  }
>() {}

export const makeAppAttestMiddleware = Effect.gen(function*() {
  const {
    isPackageNameValid,
    consumeChallenge,
    getAssertion,
    verifyAssertion,
    commitAssertion,
  } = yield* AppAttestMiddlewareConfig
  const runtime = yield* Effect.runtime()

  return createMiddleware(async (c, next) => {
    const result = await Effect.gen(function*() {
      const packageName = c.req.header('Auth-iOS-Package')
      const payload = c.req.header('Auth-Payload')
      const challenge = c.req.header('Auth-Challenge')
      const keyId = c.req.header('Auth-iOS-KeyId')
      const clientId = c.req.header('Auth-ClientId')

      if (!packageName) {
        return c.json({ error: 'Missing iOS package name header' }, 401)
      }

      if (!(yield* isPackageNameValid(packageName))) {
        return c.json({ error: 'Invalid iOS package name header' }, 401)
      }

      if (!payload) {
        return c.json({ error: 'Missing App Attest payload header' }, 401)
      }

      if (!challenge) {
        return c.json({ error: 'Missing App Attest challenge header' }, 401)
      }

      if (!keyId) {
        return c.json({ error: 'Missing App Attest key ID header' }, 401)
      }

      if (!clientId) {
        return c.json({ error: 'Missing App Attest client ID header' }, 401)
      }

      const decodeClientIdResult = S.decodeEither(S.Uint8ArrayFromBase64)(clientId)
      if (Either.isLeft(decodeClientIdResult)) {
        return c.json({
          error: `Invalid App Attest client ID: expected base64 encoding, ${decodeClientIdResult.left.toString()}`,
        }, 400)
      }

      const decodedClientId = decodeClientIdResult.right

      const decodeChallengeResult = S.decodeEither(S.Uint8ArrayFromBase64)(challenge)
      if (Either.isLeft(decodeChallengeResult)) {
        return c.json({
          error: `Invalid App Attest challenge: expected base64 encoding, ${decodeChallengeResult.left.toString()}`,
        }, 400)
      }

      const decodedChallenge = decodeChallengeResult.right

      const consumeChallengeResult = yield* consumeChallenge(decodedChallenge).pipe(Effect.either)
      if (Either.isLeft(consumeChallengeResult)) {
        return c.json({ error: 'Invalid or expired App Attest challenge' }, 401)
      }

      const decodePayloadResult = S.decodeEither(S.Uint8ArrayFromBase64)(payload)
      if (Either.isLeft(decodePayloadResult)) {
        return c.json({
          error: `Invalid App Attest payload: expected base64 encoding, ${decodePayloadResult.left.toString()}`,
        }, 400)
      }

      const decodedPayload = decodePayloadResult.right

      const decodeKeyIdResult = S.decodeEither(KeyId)(keyId)
      if (Either.isLeft(decodeKeyIdResult)) {
        return c.json({
          error: `Invalid App Attest key ID: expected base64 encoding, ${decodeKeyIdResult.left.toString()}`,
        }, 400)
      }

      const decodedKeyId = decodeKeyIdResult.right

      if (!c.req.raw.body) {
        return c.json({ error: 'Missing App Attest assertion body' }, 401)
      }

      const bodyBytes = yield* Effect.promise(() => c.req.bytes())

      const getAssertionResult = yield* getAssertion({
        keyId: decodedKeyId,
      }).pipe(Effect.either)

      if (Either.isLeft(getAssertionResult)) {
        return c.json({ error: `Failed to get App Attest assertion: ${getAssertionResult.left.message}` }, 401)
      }

      const { attestation, publicKey } = getAssertionResult.right
      const verifyResult = yield* verifyAssertion({
        attestation,
        publicKey,
        challenge: decodedChallenge,
        clientData: bodyBytes,
        assertion: decodedPayload,
        clientId: decodedClientId,
      }).pipe(Effect.either)

      if (Either.isLeft(verifyResult)) {
        return c.json({ error: `Invalid App Attest assertion: ${verifyResult.left.message}` }, 401)
      }

      const { nextSignCount } = verifyResult.right
      const commitResult = yield* commitAssertion({
        keyId: decodedKeyId,
        nextSignCount,
      }).pipe(Effect.either)

      if (Either.isLeft(commitResult)) {
        return c.json({ error: `Failed to commit App Attest assertion: ${commitResult.left.message}` }, 401)
      }
    }).pipe(
      Effect.catchAllDefect((cause) => AppAttestMiddlewareError.make({ cause })),
      Effect.either,
      Runtime.runPromise(runtime),
    )

    if (Either.isLeft(result)) {
      throw result.left
    }

    const response = result.right

    if (!response) return await next()

    return response
  })
})
