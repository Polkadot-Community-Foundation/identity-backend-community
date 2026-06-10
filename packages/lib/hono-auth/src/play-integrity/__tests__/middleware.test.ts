import { it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { decodeBase64Url, encodeBase64, encodeBase64Url } from 'effect/Encoding'
import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import * as crypto from 'node:crypto'
import { afterEach, describe, expect, vi } from 'vitest'
import { makePlayIntegrityMiddleware, PlayIntegrityMiddlewareConfig } from '../middleware.js'
import { ConsumeChallengeError } from '../types.js'

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
    it.effect('Should_Fail_When_NoncesNotEqual', (c) =>
      Effect.gen(function*() {
        const client = yield* makeClient

        yield* mockAllSuccess
        yield* Effect.sync(() =>
          buildClientDataHash.mockImplementation(() =>
            Effect.sync(() => {
              const arr = new Uint8Array(16)
              crypto.getRandomValues(arr)

              return arr
            })
          )
        )

        const res = yield* Effect.tryPromise(() =>
          client.test.$post({ json: {} }, {
            headers: {
              'Auth-Android-Package': 'test',
              'Auth-Payload': 'test',
              'Auth-Challenge': encodeBase64('test'),
              'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
            },
          })
        )
        const resBody = yield* Effect.promise(() => res.json())
        expect(resBody).toEqual({
          error: 'Invalid Play Integrity Nonce: Nonce does not match the expected client data hash',
        })
        c.expect(res.status).toEqual(401)
      }))

    it.effect('Should_Pass_When_AllChecksPass', (c) =>
      Effect.gen(function*() {
        const client = yield* makeClient

        yield* mockAllSuccess

        const res = yield* Effect.tryPromise(() =>
          client.test.$post({ json: {} }, {
            headers: {
              'Auth-Android-Package': 'test',
              'Auth-Payload': 'test',
              'Auth-Challenge': encodeBase64('test'),
              'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
            },
          })
        )
        const resBody = yield* Effect.promise(() => res.json())
        c.expect(resBody).toEqual({ success: true })
        c.expect(res.status).toEqual(200)
      }))

    // New test for header permutations
    describe('Header permutations', () => {
      it.effect('Should_Return401_When_PackageHeaderButMissingOthers', (c) =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-Android-Package': 'test',
              },
            })
          )
          const payload = yield* Effect.promise(() => res.json())
          expect(payload).toEqual({ error: 'Missing Play Integrity token header' })
          c.expect(res.status).toEqual(401)
        }))

      it.effect('Should_Return401_When_OnlySomeAuthHeadersProvided', (c) =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-Android-Package': 'test',
                'Auth-Payload': 'test',
              },
            })
          )
          const payload = yield* Effect.promise(() => res.json())
          expect(payload).toEqual({ error: 'Missing Play Integrity challenge header' })
          c.expect(res.status).toEqual(401)
        }))

      it.effect('Should_Fail_When_PackageNameHeaderInvalid', (c) =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess
          yield* Effect.sync(() => isPackageNameValid.mockImplementation(() => Effect.succeed(false)))

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-Android-Package': 'invalid',
                'Auth-Payload': 'test',
                'Auth-Challenge': encodeBase64('test'),
              },
            })
          )
          const payload = yield* Effect.promise(() => res.json())
          expect(payload).toEqual({ error: 'Invalid Android package name header' })
          c.expect(res.status).toEqual(401)
        }))

      it.effect('Should_Fail_When_ChallengeNotBase64Encoded', (c) =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-Android-Package': 'test',
                'Auth-Payload': 'test',
                'Auth-Challenge': '!@#$',
                'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
              },
            })
          )
          const payload = yield* Effect.promise(() => res.json())
          expect(payload).toEqual(expect.objectContaining({
            error: expect.stringMatching(/^Invalid Play Integrity challenge: expected base64 encoding/),
          }))
          c.expect(res.status).toEqual(400)
        }))

      it.effect('Should_Fail_When_ClientIdNotBase64Encoded', (c) =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-Android-Package': 'test',
                'Auth-Payload': 'test',
                'Auth-Challenge': encodeBase64('test'),
                'Auth-ClientId': 'invalid-base64!@#$',
              },
            })
          )
          const payload = yield* Effect.promise(() => res.json())
          expect(payload).toEqual(expect.objectContaining({
            error: expect.stringMatching(/^Invalid Play Integrity client ID: expected base64 encoding/),
          }))
          c.expect(res.status).toEqual(400)
        }))

      it.effect('Should_Fail_When_ChallengeHeaderInvalid', (c) =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess
          yield* Effect.sync(() =>
            consumeChallenge.mockImplementation(() => Effect.fail(ConsumeChallengeError.make({})))
          )

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-Android-Package': 'invalid',
                'Auth-Payload': 'test',
                'Auth-Challenge': encodeBase64('test'),
                'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
              },
            })
          )
          const payload = yield* Effect.promise(() => res.json())
          expect(payload).toEqual({ error: 'Invalid or expired challenge' })
          c.expect(res.status).toEqual(401)
        }))
    })

    describe('Nonce validation', () => {
      it.effect('Should_Fail_When_NonceNotBase64UrlEncoded', (c) =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess
          yield* Effect.sync(() =>
            decodeIntegrityToken.mockImplementation(() =>
              Effect.succeed({
                tokenPayloadExternal: {
                  requestDetails: {
                    nonce: '!@#$%^&*', // Invalid base64url string
                  },
                },
              })
            )
          )

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-Android-Package': 'test',
                'Auth-Payload': 'test',
                'Auth-Challenge': encodeBase64('test'),
                'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
              },
            })
          )
          const resBody = yield* Effect.promise(() => res.json())
          expect(resBody).toEqual(expect.objectContaining({
            error: expect.stringMatching(/^Invalid nonce: Nonce is not base64 url encoded/),
          }))
          c.expect(res.status).toEqual(401)
        }))
    })

    describe('Auth enforcement', () => {
      it.effect('Should_Return401_When_NoAuthHeadersProvided', (c) =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {},
            })
          )
          const payload = yield* Effect.promise(() => res.json())
          expect(payload).toEqual({ error: 'Missing Android package name header' })
          c.expect(res.status).toEqual(401)
        }))
    })
  })
})
