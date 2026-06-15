import { ChallengeRejectedError } from '@identity-backend/auth/types'
import type { playintegrity_v1 } from '@identity-backend/play-integrity'
import { equals as bytesEquals } from '@std/bytes/equals'
import { Context, Effect, Either, pipe, Runtime, Schema as S } from 'effect'
import { decodeBase64Url } from 'effect/Encoding'
import { createMiddleware } from 'hono/factory'
import { IntegrityErrorResponse, type InvalidTokenError, PlayIntegrityMiddlewareError } from './types.js'

export namespace PlayIntegrityMiddlewareConfig {
  export interface BuildClientDataHashParams {
    readonly challenge: Uint8Array
    readonly payload: Uint8Array
    readonly clientId: Uint8Array
  }

  export interface DecodeIntegrityTokenParams {
    readonly packageName: string
    readonly integrityToken: string
  }
  export interface DecodeIntegrityTokenResult extends playintegrity_v1.Schema$DecodeIntegrityTokenResponse {}
}

type BuildClientDataHashParams = PlayIntegrityMiddlewareConfig.BuildClientDataHashParams
type DecodeIntegrityTokenParams = PlayIntegrityMiddlewareConfig.DecodeIntegrityTokenParams
type DecodeIntegrityTokenResult = PlayIntegrityMiddlewareConfig.DecodeIntegrityTokenResult

export class PlayIntegrityMiddlewareConfig
  extends Context.Tag('PlayIntegrityMiddlewareConfig')<PlayIntegrityMiddlewareConfig, {
    readonly buildClientDataHash: (_: BuildClientDataHashParams) => Effect.Effect<Uint8Array>
    readonly isTokenValid: (_: playintegrity_v1.Schema$TokenPayloadExternal) => Effect.Effect<void, InvalidTokenError>
    readonly isPackageNameValid: (_: string) => Effect.Effect<boolean, never, never>
    readonly consumeChallenge: (_: Uint8Array) => Effect.Effect<void, ChallengeRejectedError>
    readonly decodeIntegrityToken: (_: DecodeIntegrityTokenParams) => Effect.Effect<DecodeIntegrityTokenResult>
  }>()
{}

export const makePlayIntegrityMiddleware = Effect.gen(function*() {
  const {
    buildClientDataHash,
    isTokenValid,
    isPackageNameValid,
    consumeChallenge,
    decodeIntegrityToken,
  } = yield* PlayIntegrityMiddlewareConfig
  const runtime = yield* Effect.runtime()

  return createMiddleware(async (c, next) => {
    const result = await Effect.gen(function*() {
      const packageName = c.req.header('Auth-Android-Package')
      const integrityToken = c.req.header('Auth-Payload')
      const challenge = c.req.header('Auth-Challenge')
      const clientId = c.req.header('Auth-ClientId')

      if (!packageName) {
        return c.json({ error: 'Missing Android package name header' }, 401)
      }

      if (!(yield* isPackageNameValid(packageName))) {
        return c.json({ error: 'Invalid Android package name header' }, 401)
      }

      if (!integrityToken) {
        return c.json({ error: 'Missing Play Integrity token header' }, 401)
      }

      if (!challenge) {
        return c.json({ error: 'Missing Play Integrity challenge header' }, 401)
      }

      if (!clientId) {
        return c.json({ error: 'Missing Play Integrity client ID header' }, 401)
      }

      const decodeClientIdResult = S.decodeEither(S.Uint8ArrayFromBase64)(clientId)
      if (Either.isLeft(decodeClientIdResult)) {
        return c.json({
          error: `Invalid Play Integrity client ID: expected base64 encoding, ${decodeClientIdResult.left.toString()}`,
        }, 400)
      }

      const decodedClientId = decodeClientIdResult.right

      const decodeChallengeResult = S.decodeEither(S.Uint8ArrayFromBase64)(challenge)
      if (Either.isLeft(decodeChallengeResult)) {
        return c.json({
          error: `Invalid Play Integrity challenge: expected base64 encoding, ${decodeChallengeResult.left.toString()}`,
        }, 400)
      }

      const decodedChallenge = decodeChallengeResult.right

      const consumeChallengeResult = yield* consumeChallenge(decodedChallenge).pipe(Effect.either)

      if (Either.isLeft(consumeChallengeResult)) {
        return c.json({ error: 'Invalid or expired challenge' }, 401)
      }

      const response = yield* decodeIntegrityToken({
        packageName,
        integrityToken,
      })

      const { tokenPayloadExternal } = response
      if (!tokenPayloadExternal) {
        return c.json({ error: 'Play Integrity verification failed: Token missing' }, 401)
      }

      const validationResult = yield* isTokenValid(tokenPayloadExternal).pipe(Effect.either)
      if (Either.isLeft(validationResult)) {
        yield* Effect.logDebug('Play Integrity token verdicts rejected').pipe(
          Effect.annotateLogs({
            'play_integrity.package': packageName,
            'play_integrity.app_recognition': String(
              tokenPayloadExternal.appIntegrity?.appRecognitionVerdict ?? 'absent',
            ),
            'play_integrity.app_licensing': String(
              tokenPayloadExternal.accountDetails?.appLicensingVerdict ?? 'absent',
            ),
            'play_integrity.device_recognition':
              tokenPayloadExternal.deviceIntegrity?.deviceRecognitionVerdict?.join(',') ?? 'absent',
            'play_integrity.error_codes': validationResult.left.codes.join(','),
          }),
        )

        const errorResponse = pipe(
          IntegrityErrorResponse.make({
            error: 'Play Integrity verification failed',
            errorCodes: validationResult.left.codes,
          }),
          S.encodeSync(IntegrityErrorResponse),
        )

        return c.json(errorResponse, 401)
      }

      if (c.req.raw.body) {
        const bodyBytes = yield* Effect.promise(() => c.req.bytes())
        const expectedNonce = yield* buildClientDataHash({
          challenge: decodedChallenge,
          payload: bodyBytes,
          clientId: decodedClientId,
        })

        const decodeNonceResult = decodeBase64Url(tokenPayloadExternal.requestDetails!.nonce!)
        if (Either.isLeft(decodeNonceResult)) {
          return c.json({ error: `Invalid nonce: Nonce is not base64 url encoded` }, 401)
        }
        const actualNonce = decodeNonceResult.right

        if (!bytesEquals(expectedNonce, actualNonce)) {
          return c.json({
            error: 'Invalid Play Integrity Nonce: Nonce does not match the expected client data hash',
          }, 401)
        }
      }
    }).pipe(
      Effect.catchAllDefect((cause) => PlayIntegrityMiddlewareError.make({ cause })),
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
