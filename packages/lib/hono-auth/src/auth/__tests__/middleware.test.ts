import { describe, expect, it } from '@effect/vitest'
import { checkResponse } from '@identity-backend/testing/hono'
import { Effect, Layer } from 'effect'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { testClient } from 'hono/testing'
import { AuthMiddlewareConfig, makeAuthMiddleware } from '../middleware.js'

const mockPlayIntegrityMiddleware = createMiddleware(async (c, next) => {
  if (c.req.header('Auth-Android-Package') === 'invalid') {
    return c.json({ error: 'Invalid Android package' }, 401)
  }
  return next()
})

const mockAppAttestMiddleware = createMiddleware(async (c, next) => {
  if (c.req.header('Auth-iOS-Package') === 'invalid') {
    return c.json({ error: 'Invalid iOS package' }, 401)
  }
  return next()
})

describe('Auth Plugin Test', () => {
  const makeClient = (enforceAuth: boolean) =>
    Effect.gen(function*() {
      const middleware = yield* makeAuthMiddleware(
        mockPlayIntegrityMiddleware,
        mockAppAttestMiddleware,
      ).pipe(
        Effect.provide(Layer.succeed(AuthMiddlewareConfig, { enforceAuth })),
      )

      return yield* Effect.sync(() => {
        const app = new Hono()
          .use('*', middleware)
          .get('/', (c) => {
            const statusCode: 200 | 401 = 200 + 0 as 200 | 401
            return c.json({ success: true }, statusCode)
          })

        return testClient(app)
      })
    })

  it.effect('Should_EnforceAuthHeaders_When_EnforceAuthIsTrue', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(true)

      const response = yield* Effect.tryPromise(() => client.index.$get({}, { headers: {} }))
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({
        error:
          'Missing one of [Auth-iOS-Package, Auth-Android-Package, Auth-Attestation-Token, Auth-Attestation-Type] headers',
      })
      checkResponse(response, 401)
    }))

  it.effect('Should_NotEnforceAuthHeaders_When_EnforceAuthIsFalse', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(false)

      const response = yield* Effect.tryPromise(() => client.index.$get({}, { headers: {} }))
      expect(response.status).toBe(200)
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({ success: true })
    }))

  it.effect('Should_RejectAndroid_When_AttestationTypeMissing', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(true)

      const response = yield* Effect.tryPromise(() =>
        client.index.$get({}, {
          headers: {
            'Auth-Android-Package': 'valid.android.package',
          },
        })
      )
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({
        _tag: 'MissingAttestationTypeHeader',
        error: 'Missing Auth-Attestation-Type header. Android requests must declare play-integrity or key-attestation.',
      })
      checkResponse(response, 400)
    }))

  it.effect('Should_RejectAndroid_When_AttestationTypeUnknown', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(true)

      const response = yield* Effect.tryPromise(() =>
        client.index.$get({}, {
          headers: {
            'Auth-Android-Package': 'valid.android.package',
            'Auth-Attestation-Type': 'unknown',
          },
        })
      )
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({
        _tag: 'UnknownAttestationType',
        error: 'Unknown Auth-Attestation-Type header. Expected one of: play-integrity, key-attestation.',
      })
      checkResponse(response, 400)
    }))

  it.effect('Should_DispatchToPlayIntegrity_When_AttestationTypeIsPlayIntegrity', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(true)

      const response = yield* Effect.tryPromise(() =>
        client.index.$get({}, {
          headers: {
            'Auth-Android-Package': 'valid.android.package',
            'Auth-Attestation-Type': 'play-integrity',
          },
        })
      )
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({ success: true })
      checkResponse(response, 200)
    }))

  it.effect('Should_DispatchToNext_When_AttestationTypeIsKeyAttestation', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(true)

      const response = yield* Effect.tryPromise(() =>
        client.index.$get({}, {
          headers: {
            'Auth-Attestation-Type': 'key-attestation',
          },
        })
      )
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({ success: true })
      checkResponse(response, 200)
    }))

  it.effect('Should_HandleInvalidAndroidPackage_When_PlayIntegrityRejects', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(true)

      const response = yield* Effect.tryPromise(() =>
        client.index.$get({}, {
          headers: {
            'Auth-Android-Package': 'invalid',
            'Auth-Attestation-Type': 'play-integrity',
          },
        })
      )
      expect(response.status).toBe(401)
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({
        error: 'Invalid Android package',
      })
    }))

  it.effect('Should_HandleInvalidiOSPackage_When_InvalidPackage', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(true)

      const response = yield* Effect.tryPromise(() =>
        client.index.$get({}, {
          headers: {
            'Auth-iOS-Package': 'invalid',
          },
        })
      )
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({
        error: 'Invalid iOS package',
      })
      checkResponse(response, 401)
    }))

  it.effect('Should_IgnoreAttestationTypeForiOS_When_HeaderPresent', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(true)

      const response = yield* Effect.tryPromise(() =>
        client.index.$get({}, {
          headers: {
            'Auth-iOS-Package': 'valid.ios.package',
            'Auth-Attestation-Type': 'unknown',
          },
        })
      )
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({ success: true })
      checkResponse(response, 200)
    }))

  it.effect('Should_Reject_When_BothiOSAndAndroidHeadersPresent', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(true)

      const response = yield* Effect.tryPromise(() =>
        client.index.$get({}, {
          headers: {
            'Auth-iOS-Package': 'valid.ios.package',
            'Auth-Android-Package': 'valid.android.package',
            'Auth-Attestation-Type': 'play-integrity',
          },
        })
      )
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({
        error: "Only one of ['Auth-iOS-Package', 'Auth-Android-Package'] is allowed",
      })
      checkResponse(response, 401)
    }))

  it.effect('Should_CheckAuthHeadersBeforePlatformSpecificMiddleware_When_BothHeadersPresent', () =>
    Effect.gen(function*() {
      const client = yield* makeClient(true)

      const response = yield* Effect.tryPromise(() =>
        client.index.$get({}, {
          headers: {
            'Auth-iOS-Package': 'valid.ios.package',
            'Auth-Android-Package': 'valid.android.package',
            'Auth-Attestation-Type': 'play-integrity',
          },
        })
      )
      const jsonResponse = yield* Effect.promise(() => response.json())
      expect(jsonResponse).toEqual({
        error: "Only one of ['Auth-iOS-Package', 'Auth-Android-Package'] is allowed",
      })
      checkResponse(response, 401)
    }))
})
