import { describe, it } from '@effect/vitest'
import { Effect, Either, Layer, Schema as S } from 'effect'
import { decodeBase64Url, encodeBase64, encodeBase64Url } from 'effect/Encoding'
import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import { afterEach, expect, vi } from 'vitest'
import { makePlayIntegrityMiddleware, PlayIntegrityMiddlewareConfig } from '../middleware.js'
import { IntegrityErrorResponse, InvalidTokenError, PlayIntegrityErrorCode } from '../types.js'

describe('PlayIntegrityMiddleware', () => {
  const buildClientDataHash = vi.fn<PlayIntegrityMiddlewareConfig['Type']['buildClientDataHash']>()
  const isTokenValid = vi.fn<PlayIntegrityMiddlewareConfig['Type']['isTokenValid']>()
  const isPackageNameValid = vi.fn<PlayIntegrityMiddlewareConfig['Type']['isPackageNameValid']>()
  const consumeChallenge = vi.fn<PlayIntegrityMiddlewareConfig['Type']['consumeChallenge']>()
  const decodeIntegrityToken = vi.fn<PlayIntegrityMiddlewareConfig['Type']['decodeIntegrityToken']>()

  const layer = Layer.succeed(
    PlayIntegrityMiddlewareConfig,
    {
      buildClientDataHash,
      isTokenValid,
      isPackageNameValid,
      consumeChallenge,
      decodeIntegrityToken,
    },
  )

  afterEach(() => {
    buildClientDataHash.mockReset()
    isTokenValid.mockReset()
    isPackageNameValid.mockReset()
    consumeChallenge.mockReset()
    decodeIntegrityToken.mockReset()
  })

  const makeClient = Effect.gen(function*() {
    const playIntegrityMiddleware = yield* makePlayIntegrityMiddleware

    return yield* Effect.sync(() => {
      const app = new Hono()
        .use(playIntegrityMiddleware)
        .post(
          '/test',
          async (c) => c.json({ success: true }, 200),
        )

      return testClient(app)
    })
  })

  const mockAllSuccess = Effect.sync(() => {
    isPackageNameValid.mockImplementation(() => Effect.succeed(true))
    consumeChallenge.mockImplementation(() => Effect.succeed(void 0))
    decodeIntegrityToken.mockImplementation(() =>
      Effect.succeed({
        tokenPayloadExternal: {
          requestDetails: {
            nonce: encodeBase64Url('valid nonce'),
          },
        },
      })
    )
    isTokenValid.mockImplementation(() => Effect.succeed(void 0))
    buildClientDataHash.mockImplementation(() => decodeBase64Url(encodeBase64Url('valid nonce')).pipe(Effect.orDie))
  })

  it.layer(layer)((it) => {
    it.effect.prop(
      '¬Token_Verify_→⊥',
      [S.Set(PlayIntegrityErrorCode)],
      ([errors]) =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess
          isTokenValid.mockImplementation(() =>
            Effect.fail(InvalidTokenError.make({
              codes: [...errors],
            }))
          )

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-Android-Package': 'test',
                'Auth-Payload': 'test',
                'Auth-Challenge': encodeBase64('test'),
                'Auth-ClientId': '00'.repeat(32),
              },
            })
          )
          const resBody = yield* Effect.promise(() => res.json())

          const expectedResponse: IntegrityErrorResponse = IntegrityErrorResponse.make({
            error: 'Play Integrity verification failed',
            errorCodes: [...errors],
          })

          expect(S.decodeUnknownEither(IntegrityErrorResponse)(resBody))
            .toStrictEqual(Either.right(expectedResponse))
          expect(res.status).toEqual(401)
        }),
    )
  })
})
