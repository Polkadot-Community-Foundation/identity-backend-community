import { it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { encodeBase64 } from 'effect/Encoding'
import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import { afterEach, describe, expect, vi } from 'vitest'
import { AppAttestMiddlewareConfig, makeAppAttestMiddleware } from '../middleware.js'
import { AppAttestError, ConsumeChallengeError } from '../types.js'

describe('AppleAttestMiddleware', () => {
  const isPackageNameValid = vi.fn<AppAttestMiddlewareConfig['Type']['isPackageNameValid']>()
  const consumeChallenge = vi.fn<AppAttestMiddlewareConfig['Type']['consumeChallenge']>()
  const getAssertion = vi.fn<AppAttestMiddlewareConfig['Type']['getAssertion']>()
  const verifyAssertion = vi.fn<AppAttestMiddlewareConfig['Type']['verifyAssertion']>()
  const commitAssertion = vi.fn<AppAttestMiddlewareConfig['Type']['commitAssertion']>()

  const layer = Layer.succeed(
    AppAttestMiddlewareConfig,
    {
      isPackageNameValid,
      consumeChallenge,
      getAssertion,
      verifyAssertion,
      commitAssertion,
    },
  )

  afterEach(() => {
    isPackageNameValid.mockReset()
    consumeChallenge.mockReset()
    getAssertion.mockReset()
    verifyAssertion.mockReset()
    commitAssertion.mockReset()
  })

  const makeClient = Effect.gen(function*() {
    const appAttestMiddleware = yield* makeAppAttestMiddleware

    return yield* Effect.sync(() => {
      const app = new Hono()
        .use(appAttestMiddleware)
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
    getAssertion.mockImplementation(() =>
      Effect.succeed({
        attestation: { publicKey: 'test-pub-key', signCount: 0 },
        publicKey: {} as CryptoKey,
      })
    )
    verifyAssertion.mockImplementation(() =>
      Effect.succeed({
        publicKey: {} as CryptoKey,
        nextSignCount: 1,
      })
    )
    commitAssertion.mockImplementation(() => Effect.succeed(void 0))
  })

  it.layer(layer)((it) => {
    it.effect('Should_Fail_When_PackageNameInvalid', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        yield* mockAllSuccess
        yield* Effect.sync(() => isPackageNameValid.mockImplementation(() => Effect.succeed(false)))

        const res = yield* Effect.tryPromise(() =>
          client.test.$post({ json: {} }, {
            headers: {
              'Auth-iOS-Package': 'invalid-package',
              'Auth-iOS-KeyId': encodeBase64('test-key-id'),
              'Auth-Payload': encodeBase64('test-payload'),
              'Auth-Challenge': encodeBase64('test-challenge'),
              'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
            },
          })
        )
        const resBody = yield* Effect.promise(() => res.json())
        expect(resBody).toEqual({ error: 'Invalid iOS package name header' })
        expect(res.status).toEqual(401)
      }))

    it.effect('Should_Fail_When_ChallengeConsumptionFails', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        yield* mockAllSuccess
        yield* Effect.sync(() => consumeChallenge.mockImplementation(() => ConsumeChallengeError.make({})))

        const res = yield* Effect.tryPromise(() =>
          client.test.$post({ json: {} }, {
            headers: {
              'Auth-iOS-Package': 'valid-package',
              'Auth-iOS-KeyId': encodeBase64('test-key-id'),
              'Auth-Payload': encodeBase64('test-payload'),
              'Auth-Challenge': encodeBase64('test-challenge'),
              'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
            },
          })
        )
        const resBody = yield* Effect.promise(() => res.json())
        expect(resBody).toEqual({ error: 'Invalid or expired App Attest challenge' })
        expect(res.status).toEqual(401)
      }))

    it.effect('Should_Fail_When_GetAssertionFails', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        yield* mockAllSuccess
        yield* Effect.sync(() =>
          getAssertion.mockImplementation(() => Effect.fail(AppAttestError.make({ cause: 'Attestation not found' })))
        )

        const res = yield* Effect.tryPromise(() =>
          client.test.$post({ json: {} }, {
            headers: {
              'Auth-iOS-Package': 'valid-package',
              'Auth-iOS-KeyId': encodeBase64('test-key-id'),
              'Auth-Payload': encodeBase64('test-payload'),
              'Auth-Challenge': encodeBase64('test-challenge'),
              'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
            },
          })
        )
        const resBody = yield* Effect.promise(() => res.json())
        expect(resBody).toEqual(expect.objectContaining({
          error: expect.stringMatching(/^Failed to get App Attest assertion/),
        }))
        expect(res.status).toEqual(401)
      }))

    it.effect('Should_Fail_When_AssertionVerificationFails', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        yield* mockAllSuccess
        yield* Effect.sync(() =>
          verifyAssertion.mockImplementation(() =>
            Effect.fail(AppAttestError.make({ cause: 'Assertion verification failed' }))
          )
        )

        const res = yield* Effect.tryPromise(() =>
          client.test.$post({ json: {} }, {
            headers: {
              'Auth-iOS-Package': 'valid-package',
              'Auth-iOS-KeyId': encodeBase64('test-key-id'),
              'Auth-Payload': encodeBase64('test-payload'),
              'Auth-Challenge': encodeBase64('test-challenge'),
              'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
            },
          })
        )
        const resBody = yield* Effect.promise(() => res.json())
        expect(resBody).toEqual(expect.objectContaining({
          error: expect.stringMatching(/^Invalid App Attest assertion/),
        }))
        expect(res.status).toEqual(401)
      }))

    it.effect('Should_Fail_When_CommitAssertionFails', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        yield* mockAllSuccess
        yield* Effect.sync(() =>
          commitAssertion.mockImplementation(() =>
            Effect.fail(AppAttestError.make({ cause: 'Commit assertion failed' }))
          )
        )

        const res = yield* Effect.tryPromise(() =>
          client.test.$post({ json: {} }, {
            headers: {
              'Auth-iOS-Package': 'valid-package',
              'Auth-iOS-KeyId': encodeBase64('test-key-id'),
              'Auth-Payload': encodeBase64('test-payload'),
              'Auth-Challenge': encodeBase64('test-challenge'),
              'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
            },
          })
        )
        const resBody = yield* Effect.promise(() => res.json())
        expect(resBody).toEqual(expect.objectContaining({
          error: expect.stringMatching(/^Failed to commit App Attest assertion/),
        }))
        expect(res.status).toEqual(401)
      }))

    it.effect('Should_Succeed_When_AllChecksPass', (c) =>
      Effect.gen(function*() {
        const client = yield* makeClient

        yield* mockAllSuccess

        const res = yield* Effect.tryPromise(() =>
          client.test.$post({ json: {} }, {
            headers: {
              'Auth-iOS-Package': 'valid-package',
              'Auth-iOS-KeyId': encodeBase64('test-key-id'),
              'Auth-Payload': encodeBase64('test-payload'),
              'Auth-Challenge': encodeBase64('test-challenge'),
              'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
            },
          })
        )
        const resBody = yield* Effect.promise(() => res.json())
        c.expect(resBody).toEqual({ success: true })
        c.expect(res.status).toEqual(200)
      }))

    // Test for header permutations
    describe('Header permutations', () => {
      it.effect('Should_Return401_When_PackageHeaderButMissingOthers', () =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-iOS-Package': 'valid-package',
              },
            })
          )
          const payload = yield* Effect.promise(() => res.json())
          expect(payload).toEqual({ error: 'Missing App Attest payload header' })
          expect(res.status).toEqual(401)
        }))

      it.effect('Should_Return401_When_OnlySomeAuthHeadersProvided', () =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-iOS-Package': 'valid-package',
                'Auth-Payload': encodeBase64('test-payload'),
              },
            })
          )
          const payload = yield* Effect.promise(() => res.json())
          expect(payload).toEqual({ error: 'Missing App Attest challenge header' })
          expect(res.status).toEqual(401)
        }))
    })

    describe('Invalid base64 encoding', () => {
      it.effect('Should_Fail_When_InvalidBase64EncodingForPayload', () =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-iOS-Package': 'valid-package',
                'Auth-iOS-KeyId': encodeBase64('test-key-id'),
                'Auth-Payload': 'invalid-base64!@#$',
                'Auth-Challenge': encodeBase64('test-challenge'),
                'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
              },
            })
          )
          const resBody = yield* Effect.promise(() => res.json())
          expect(resBody).toEqual(expect.objectContaining({
            error: expect.stringMatching(/^Invalid App Attest payload: expected base64 encoding/),
          }))
          expect(res.status).toEqual(400)
        }))

      it.effect('Should_Fail_When_InvalidBase64EncodingForChallenge', () =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-iOS-Package': 'valid-package',
                'Auth-iOS-KeyId': encodeBase64('test-key-id'),
                'Auth-Payload': encodeBase64('test-payload'),
                'Auth-Challenge': 'invalid-base64!@#$',
                'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
              },
            })
          )
          const resBody = yield* Effect.promise(() => res.json())
          expect(resBody).toEqual(expect.objectContaining({
            error: expect.stringMatching(/^Invalid App Attest challenge: expected base64 encoding/),
          }))
          expect(res.status).toEqual(400)
        }))

      it.effect('Should_Fail_When_InvalidBase64EncodingForKeyId', () =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-iOS-Package': 'valid-package',
                'Auth-iOS-KeyId': 'invalid-base64!@#$',
                'Auth-Payload': encodeBase64('test-payload'),
                'Auth-Challenge': encodeBase64('test-challenge'),
                'Auth-ClientId': encodeBase64(new Uint8Array(32).fill(0)),
              },
            })
          )
          const resBody = yield* Effect.promise(() => res.json())
          expect(resBody).toEqual(expect.objectContaining({
            error: expect.stringMatching(/^Invalid App Attest key ID: expected base64 encoding/),
          }))
          expect(res.status).toEqual(400)
        }))

      it.effect('Should_Fail_When_InvalidBase64EncodingForClientId', () =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {
                'Auth-iOS-Package': 'valid-package',
                'Auth-iOS-KeyId': encodeBase64('test-key-id'),
                'Auth-Payload': encodeBase64('test-payload'),
                'Auth-Challenge': encodeBase64('test-challenge'),
                'Auth-ClientId': 'invalid-base64!@#$',
              },
            })
          )
          const resBody = yield* Effect.promise(() => res.json())
          expect(resBody).toEqual(expect.objectContaining({
            error: expect.stringMatching(/^Invalid App Attest client ID: expected base64 encoding/),
          }))
          expect(res.status).toEqual(400)
        }))
    })

    describe('Auth enforcement', () => {
      it.effect('Should_Return401_When_NoAuthHeadersProvided', () =>
        Effect.gen(function*() {
          const client = yield* makeClient

          yield* mockAllSuccess

          const res = yield* Effect.tryPromise(() =>
            client.test.$post({ json: {} }, {
              headers: {},
            })
          )
          const payload = yield* Effect.promise(() => res.json())
          expect(payload).toEqual({ error: 'Missing iOS package name header' })
          expect(res.status).toEqual(401)
        }))
    })
  })
})
