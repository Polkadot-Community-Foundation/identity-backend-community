import { DB } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { RefreshTokenResponse, TokenResponse } from '#root/routes/v1/token/types.js'
import { describe, expect, it } from '@effect/vitest'
import { AuthService } from '@identity-backend/auth/services'
import { sr25519 } from '@identity-backend/crypto'
import { checkResponse } from '@identity-backend/testing/hono'
import { encodeBase64 } from '@std/encoding'
import { eq } from 'drizzle-orm'
import { Effect, TestClock } from 'effect'
import {
  createRefreshClient,
  createTokenClient,
  PAST_DATE,
  refreshTokenTestLayer,
  seedToken,
  TEST_NOW,
  TOKEN_B,
  TOKEN_C,
} from './helpers/refresh-token-test-layer.js'

const cleanUp = Effect.andThen(DB, (db) => db.delete(schema.refreshTokens).execute()).pipe(Effect.orDie)

const issueTokenPair = Effect.gen(function*() {
  const authService = yield* AuthService
  const keypair = yield* sr25519.generateKeypair()
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const proofPayload = yield* authService.buildClientDataHash({
    payload: new TextEncoder().encode('{}'),
    challenge,
    clientId: keypair.publicKey,
  })
  const clientProof = yield* keypair.sign(proofPayload)

  const tokenClient = yield* createTokenClient
  const res = yield* Effect.promise(() =>
    tokenClient.index.$post({
      header: {
        'Auth-ClientId': encodeBase64(keypair.publicKey),
        'Auth-ClientProof': encodeBase64(clientProof),
        'Auth-Challenge': encodeBase64(challenge),
      },
      json: {},
    })
  )
  checkResponse(res, 200)
  return yield* Effect.promise(() => res.json())
})

const rotateToken = (refreshTokenBase64: string) =>
  Effect.gen(function*() {
    const refreshClient = yield* createRefreshClient
    return yield* Effect.promise(() =>
      refreshClient.token.refresh.$post({ json: { refreshToken: refreshTokenBase64 } })
    )
  })

describe('Refresh token routes', () => {
  it.layer(refreshTokenTestLayer)((it) => {
    it.scoped('Should_Return200WithValidTokenPair_When_Called', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const body = yield* issueTokenPair

        expect(body).toEqual(expect.schemaMatching(TokenResponse))
        expect(body.refreshToken, 'refreshToken should be 44-char base64').toMatch(/^[A-Za-z0-9+/]{43}=?$/)
      }))

    it.scoped.each([
      { reason: 'not-found', base64: encodeBase64(new Uint8Array(32).fill(0xdd)), seed: Effect.void },
      {
        reason: 'expired',
        base64: TOKEN_B.base64,
        seed: Effect.andThen(DB, (db) => seedToken(db, { tokenHash: TOKEN_B.hash, expiresAt: PAST_DATE })),
      },
      {
        reason: 'revoked',
        base64: TOKEN_C.base64,
        seed: Effect.andThen(
          DB,
          (db) => seedToken(db, { tokenHash: TOKEN_C.hash, revokedAt: TEST_NOW, revokedReason: 'rotated' }),
        ),
      },
    ])(
      'Should_ReturnIdentical401_When_$reason',
      ({ base64, seed }) =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)
          yield* seed
          yield* TestClock.setTime(TEST_NOW.getTime())

          const refreshClient = yield* createRefreshClient
          const res = yield* Effect.promise(() => refreshClient.token.refresh.$post({ json: { refreshToken: base64 } }))
          const body = yield* Effect.promise(() => res.json() as Promise<unknown>)

          expect.soft(res.status, 'should return 401').toBe(401)
          expect.soft(res.headers.get('content-type'), 'should use problem+json').toContain('application/problem+json')
          expect.soft(body, 'body must match OWASP uniform response').toEqual({
            type: expect.stringContaining('unauthorized'),
            title: 'Invalid or Expired Refresh Token',
            detail: 'The provided refresh token is invalid, expired, or has been revoked.',
            status: 401,
          })
        }),
    )

    it.scoped('Should_Return200WithRotatedPair_When_ValidToken', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const { refreshToken } = yield* issueTokenPair
        const res = yield* rotateToken(refreshToken)

        checkResponse(res, 200)
        const body = yield* Effect.promise(() => res.json())
        expect(body).toEqual(expect.schemaMatching(RefreshTokenResponse))
      }))

    it.scoped('Should_RevokeOldTokenAsRotated_When_Rotating', () =>
      Effect.gen(function*() {
        const db = yield* DB
        yield* Effect.addFinalizer(() => cleanUp)

        yield* seedToken(db, { tokenHash: TOKEN_B.hash })

        const res = yield* rotateToken(TOKEN_B.base64)
        checkResponse(res, 200)

        const rows = yield* Effect.tryPromise(() =>
          db.select().from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, TOKEN_B.hash))
        ).pipe(Effect.orDie)

        const revokedToken = rows[0]!
        expect(revokedToken.revokedAt, 'old token should be revoked').toBeInstanceOf(Date)
        expect(revokedToken.revokedReason).toBe('rotated')
      }))

    it.scoped('Should_LinkNewTokenToSameFamily_When_Rotating', () =>
      Effect.gen(function*() {
        const db = yield* DB
        yield* Effect.addFinalizer(() => cleanUp)

        yield* seedToken(db, { tokenHash: TOKEN_B.hash, userId: '00000000-0000-0000-0000-000000000006' })

        const res = yield* rotateToken(TOKEN_B.base64)
        checkResponse(res, 200)

        const rows = yield* Effect.tryPromise(() =>
          db.select().from(schema.refreshTokens).where(
            eq(schema.refreshTokens.userId, '00000000-0000-0000-0000-000000000006'),
          )
        ).pipe(Effect.orDie)

        expect(rows.length, 'should have 2 tokens in family').toBe(2)
        const rootToken = rows.find((t) => t.rotatedFrom === null)
        const newToken = rows.find((t) => t.rotatedFrom !== null)
        expect(rootToken).toBeDefined()
        expect(newToken).toBeDefined()
        expect(newToken!.familyId, 'new token should share family with root').toEqual(rootToken!.familyId)
      }))

    it.scoped('Should_ChainMultipleRotations_When_UsingReturnedTokens', () =>
      Effect.gen(function*() {
        const db = yield* DB
        yield* Effect.addFinalizer(() => cleanUp)

        const { refreshToken: base64_1 } = yield* issueTokenPair

        const res1 = yield* rotateToken(base64_1)
        checkResponse(res1, 200)
        const { refreshToken: base64_2 } = yield* Effect.promise(() => res1.json())

        const res2 = yield* rotateToken(base64_2)
        checkResponse(res2, 200)

        const rows = yield* Effect.tryPromise(() => db.select().from(schema.refreshTokens)).pipe(Effect.orDie)

        expect(rows.length, 'should have 3 tokens after 2 rotations').toBe(3)
        const familyIds = new Set(rows.map((r) => r.familyId))
        expect(familyIds.size, 'all tokens should share one familyId').toBe(1)
      }))

    it.scoped('Should_RevokeEntireFamily_When_ReuseDetected', () =>
      Effect.gen(function*() {
        const db = yield* DB
        yield* Effect.addFinalizer(() => cleanUp)

        const { refreshToken: rootBase64 } = yield* issueTokenPair

        const res1 = yield* rotateToken(rootBase64)
        checkResponse(res1, 200)
        const { refreshToken: childBase64 } = yield* Effect.promise(() => res1.json())

        yield* rotateToken(childBase64)

        // Reuse the already-rotated rootBase64 — triggers reuse detection
        const reuseRes = yield* rotateToken(rootBase64)
        checkResponse(reuseRes, 401)

        const rows = yield* Effect.tryPromise(() => db.select().from(schema.refreshTokens)).pipe(Effect.orDie)

        const allRevoked = rows.every((t) => t.revokedAt !== null)
        expect(allRevoked, 'all tokens in family should be revoked after reuse detection').toBe(true)
      }))

    it.scoped('Should_Return401_When_TokenFromRevokedFamily', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const { refreshToken: rootBase64 } = yield* issueTokenPair

        const res1 = yield* rotateToken(rootBase64)
        checkResponse(res1, 200)
        const { refreshToken: childBase64 } = yield* Effect.promise(() => res1.json())

        // Reuse rootBase64 — revokes entire family
        const reuseRes = yield* rotateToken(rootBase64)
        checkResponse(reuseRes, 401)

        // Attempt to use childBase64 from the now-revoked family
        const childRes = yield* rotateToken(childBase64)
        checkResponse(childRes, 401)
      }))

    it.scoped('Should_Return400_When_RefreshTokenMissing', () =>
      Effect.gen(function*() {
        const refreshClient = yield* createRefreshClient
        const res = yield* Effect.promise(() =>
          // @ts-expect-error -- intentionally omitting refreshToken
          refreshClient.token.refresh.$post({ json: {} })
        )
        checkResponse(res, 400)
      }))

    it.scoped('Should_Return400_When_RefreshTokenInvalidBase64', () =>
      Effect.gen(function*() {
        const refreshClient = yield* createRefreshClient
        const res = yield* Effect.promise(() =>
          refreshClient.token.refresh.$post({ json: { refreshToken: 'not-valid-base64' } })
        )
        checkResponse(res, 400)
      }))
  })
})
