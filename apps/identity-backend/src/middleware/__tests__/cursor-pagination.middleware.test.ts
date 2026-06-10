import { CursorDecodeError } from '#root/lib/cursor-pagination/mod.js'
import { it } from '@effect/vitest'
import { Effect, Layer, Schema as S } from 'effect'
import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import { afterEach, describe, expect, vi } from 'vitest'
import { CursorPaginationMiddlewareConfig } from '../cursor-pagination.middleware.js'

describe('cursorPaginationMiddleware', () => {
  const TestSchema = S.Struct({
    offset: S.Number,
    limit: S.Number,
  })

  const _mockSign = vi.fn() // oxlint-disable-line vitest/require-mock-type-parameters
  const mockSign: ReturnType<typeof vi.fn<CursorPaginationMiddlewareConfig['Type']['sign']>> = _mockSign
  const _mockVerify = vi.fn() // oxlint-disable-line vitest/require-mock-type-parameters
  const mockVerify: ReturnType<typeof vi.fn<CursorPaginationMiddlewareConfig['Type']['verify']>> = _mockVerify

  const CursorPaginationServiceTestLayer = Layer.succeed(
    CursorPaginationMiddlewareConfig,
    {
      sign: _mockSign,
      verify: _mockVerify,
    },
  )

  const makeClient = Effect.gen(function*() {
    const { cursorPaginationMiddlewareFactoryWithoutDependencies } = yield* Effect.promise(
      () => import('../cursor-pagination.middleware.js'),
    )

    const middleware = yield* cursorPaginationMiddlewareFactoryWithoutDependencies(TestSchema)

    return yield* Effect.sync(() => {
      const app = new Hono<{ Variables: { validatedCursor?: S.Schema.Type<typeof TestSchema> } }>()
        .use('*', async (c, next) => middleware(c, next))
        .get('/test', (c) => c.json({ cursor: c.var.validatedCursor }))

      return testClient(app)
    })
  })

  afterEach(() => {
    mockSign.mockReset()
    mockVerify.mockReset()
  })

  it.layer(CursorPaginationServiceTestLayer)((it) => {
    describe('@HappyPath', () => {
      it.effect('Should_SetValidatedCursor_When_CursorIsValid', () =>
        Effect.gen(function*() {
          // --- @arrange: client with mock verify returning valid payload ---
          const client = yield* makeClient
          const mockPayload = { offset: 10, limit: 20 }
          mockVerify.mockImplementation(() => Effect.succeed(mockPayload))
          const rawToken = 'valid-token'
          const encodedToken = Buffer.from(rawToken).toString('base64')

          // --- @act: request with valid cursor token ---
          const res = yield* Effect.promise(() => client.test.$get({ query: { cursor: encodedToken } }))

          // --- @assert: cursor is decoded and set in context ---
          expect.soft(res.status, 'request should succeed when cursor is valid').toBe(200)
          const body = yield* Effect.promise(() => res.json())
          expect(body.cursor, 'validatedCursor should be set to decoded payload').toEqual(mockPayload)
        }))

      it.effect('Should_BypassValidation_When_CursorMissing', () =>
        Effect.gen(function*() {
          // --- @arrange: client with mock verify (should not be called) ---
          const client = yield* makeClient
          mockVerify.mockImplementation(() => Effect.succeed({ offset: 0, limit: 10 }))

          // --- @act: request without cursor parameter ---
          const res = yield* Effect.promise(() => client.test.$get({ query: {} }))

          // --- @assert: request succeeds with undefined cursor ---
          expect.soft(res.status, 'request should succeed when cursor is missing').toBe(200)
          const body = yield* Effect.promise(() => res.json())
          expect(body.cursor, 'validatedCursor should not be set when cursor missing').toBeUndefined()
        }))
    })

    describe('@ErrorCase', () => {
      it.effect('Should_ReturnErrorResponse_When_CursorInvalidBase64', () =>
        Effect.gen(function*() {
          // --- @arrange: client with mock verify returning decode error ---
          const client = yield* makeClient
          mockVerify.mockImplementation(() =>
            new CursorDecodeError({ cursor: 'invalid-base64!!!', cause: new Error('Invalid base64') })
          )

          // --- @act: request with invalid base64 cursor ---
          const res = yield* Effect.tryPromise(() => client.test.$get({ query: { cursor: 'invalid-base64!!!' } }))

          // --- @assert: returns error response ---
          expect.soft(res.status, 'should return error status for invalid base64').not.toBe(200)
          const body = yield* Effect.promise(() => res.json())
          expect(body, 'should return error response object').toHaveProperty('error')
        }))

      it.effect('Should_ReturnErrorResponse_When_CursorPayloadSchemaInvalid', () =>
        Effect.gen(function*() {
          // --- @arrange: client with mock verify returning schema validation error ---
          const client = yield* makeClient
          const validBase64 = Buffer.from('invalid-payload').toString('base64')
          mockVerify.mockImplementation(() =>
            new CursorDecodeError({ cursor: validBase64, cause: new Error('Schema validation failed') })
          )

          // --- @act: request with cursor containing invalid payload ---
          const res = yield* Effect.tryPromise(() => client.test.$get({ query: { cursor: validBase64 } }))

          // --- @assert: returns error response ---
          expect.soft(res.status, 'should return error status for schema validation failure').not.toBe(200)
          const body = yield* Effect.promise(() => res.json())
          expect(body, 'should return error response object').toHaveProperty('error')
        }))
    })

    describe('@EdgeCase', () => {
      it.effect('Should_BypassValidation_When_CursorIsEmptyString', () =>
        Effect.gen(function*() {
          // --- @arrange: client with mock verify (should not be called) ---
          const client = yield* makeClient
          mockVerify.mockImplementation(() => Effect.succeed({ offset: 0, limit: 10 }))

          // --- @act: request with empty string cursor ---
          const res = yield* Effect.promise(() => client.test.$get({ query: { cursor: '' } }))

          // --- @assert: request succeeds without calling verify ---
          expect.soft(res.status, 'request should succeed when cursor is empty string').toBe(200)
          expect(mockVerify, 'service.verify should not be called for empty cursor').not.toHaveBeenCalled()
        }))
    })
  })
})
