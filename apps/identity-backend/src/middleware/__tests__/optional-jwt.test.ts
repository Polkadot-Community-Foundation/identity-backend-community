import * as fc from 'fast-check'
import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../verify-jwt.js', () => ({
  verifyJwt: vi.fn<(secret: string) => MiddlewareHandler>(
    () => async (c: Context) => c.json({ error: 'unauthorized' }, 401),
  ),
}))

const { optionalJwt } = await import('../optional-jwt.js')

const METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'] as const

const makeApp = () =>
  new Hono()
    .use(optionalJwt('test-secret'))
    .all('/resource', (c) => c.json({ ok: true }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('optionalJwt orchestration', () => {
  it('Should_ReturnCorrectStatus_When_AnyMethodAndHeaderCombination', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...METHODS),
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        async (method, authHeader) => {
          const unauthenticated = authHeader === undefined
          const expectStatus = unauthenticated ? 200 : 401

          const res = await makeApp().request('/resource', {
            method,
            headers: authHeader === undefined ? {} : { Authorization: authHeader },
          })
          expect(res.status).toBe(expectStatus)
        },
      ),
    )
  })
})
