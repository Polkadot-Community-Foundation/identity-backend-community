import * as fc from 'fast-check'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { ProblemDetailZod, SMARTBEAR } from '#root/lib/problem-details.js'
import type { ProblemDetail } from '#root/lib/problem-details.js'
import { verifyJwt } from '../verify-jwt.js'

const TEST_SECRET = 'test-secret-for-verify-jwt'
const WRONG_SECRET = 'wrong-secret-for-verify-jwt'

const signToken = (payload: Record<string, string>, secret = TEST_SECRET): Promise<string> =>
  new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(secret))

const makeApp = () => new Hono().use(verifyJwt(TEST_SECRET)).get('/resource', (c) => c.json({ ok: true }))

const assertProblemDetail = (body: unknown, expectedTypeSuffix: string) => {
  expect(body).toEqual(expect.schemaMatching(ProblemDetailZod))
  expect((body as ProblemDetail).type).toBe(`${SMARTBEAR}/${expectedTypeSuffix}`)
  expect((body as ProblemDetail).status).toBe(401)
}

describe('verifyJwt', () => {
  describe.each(
    [
      { header: undefined, type: 'missing-request-header', label: 'no header' },
      { header: '', type: 'invalid-request-header-format', label: 'empty string' },
      { header: 'Bearer', type: 'invalid-request-header-format', label: 'Bearer with no token' },
      { header: 'Bearer token extra', type: 'invalid-request-header-format', label: 'many parts' },
      { header: 'Token some-value', type: 'invalid-request-header-format', label: 'wrong scheme' },
    ] as const,
  )('Should_ReturnProblemDetail_When_$label', ({ header, type }) => {
    it('', async () => {
      const headers = header === undefined ? {} : { Authorization: header }
      const res = await makeApp().request('/resource', { headers })
      expect(res.status).toBe(401)
      assertProblemDetail(await res.json(), type)
    })
  })

  describe.each(
    [
      { label: 'wrong secret', sign: (p: Record<string, string>) => signToken(p, WRONG_SECRET) },
      { label: 'garbage bearer value', sign: (_p: Record<string, string>) => Promise.resolve('not-a-jwt') },
    ] as const,
  )('Should_ReturnInvalidToken_When_$label', ({ sign }) => {
    it('', async () => {
      const token = await sign({ sub: 'test-user' })
      const res = await makeApp().request('/resource', { headers: { Authorization: `Bearer ${token}` } })
      expect(res.status).toBe(401)
      assertProblemDetail(await res.json(), 'unauthorized')
    })
  })

  it('Should_Return200_When_ValidToken', async () => {
    const token = await signToken({ sub: 'test-user' })
    const res = await makeApp().request('/resource', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
  })

  describe('property: malformed headers (Ref: PBT-DEC-07)', () => {
    it('Should_ReturnValidProblemDetail_When_MalformedAuthorizationHeader', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<'empty' | 'bad_structure' | 'bad_token'>('empty', 'bad_structure', 'bad_token'),
          fc.string({ minLength: 5, maxLength: 200 }),
          fc.record({ sub: fc.string({ minLength: 1 }) }),
          fc.integer({ min: -3600, max: -1 }),
          async (category, garbage, payload, pastExpDelta) => {
            let headers: Record<string, string>
            let expectedTypeSuffix: string

            switch (category) {
              case 'empty':
                headers = { Authorization: '' }
                expectedTypeSuffix = 'invalid-request-header-format'
                break
              case 'bad_structure':
                headers = { Authorization: `${garbage}` }
                expectedTypeSuffix = 'invalid-request-header-format'
                break
              case 'bad_token': {
                const exp = String(Math.floor(Date.now() / 1000) + pastExpDelta)
                const expiredToken = await signToken({ ...payload, exp })
                headers = { Authorization: `Bearer ${expiredToken}` }
                expectedTypeSuffix = 'unauthorized'
                break
              }
            }

            const res = await makeApp().request('/resource', { headers })
            assertProblemDetail(await res.json(), expectedTypeSuffix)
          },
        ),
      )
    })
  })
})
