import { DB, schema } from '#root/db/mod.js'
import { RefreshTokenExpired, RefreshTokenNotFound, RefreshTokenReuseDetected } from '#root/jwt/core/jwt.errors.js'
import {
  ClassificationToAction,
  ClassifyTokenCommand,
  ClassifyTokenInput,
  RefreshTokenPlain,
  RotatedTokenPair,
} from '#root/jwt/core/jwt.types.js'
import { RefreshTokenShellConfig } from '#root/jwt/shell/issue-token.use-case.js'
import { JWTAuthService } from '#root/jwt/shell/jwt-auth.service.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@polkadot-api/utils'
import { eq } from 'drizzle-orm'
import { Clock, Context, Duration, Effect, Layer, Match, Option, Redacted, Schedule, Schema as S } from 'effect'

export interface RotateTokenUseCaseApi {
  readonly rotateToken: (
    token: Uint8Array,
  ) => Effect.Effect<RotatedTokenPair, RefreshTokenExpired | RefreshTokenReuseDetected | RefreshTokenNotFound>
}

export class RotateTokenUseCase extends Context.Tag('identity-backend/jwt/shell/rotate-token/RotateTokenUseCase')<
  RotateTokenUseCase,
  RotateTokenUseCaseApi
>() {
  static readonly Default = Layer.effect(
    RotateTokenUseCase,
    Effect.gen(function*() {
      const db = yield* DB
      const jwtAuthService = yield* JWTAuthService
      const { tokenDuration } = yield* RefreshTokenShellConfig

      const dbRetry = Effect.retry(
        Schedule.intersect(
          Schedule.exponential(Duration.millis(200), 2).pipe(Schedule.jittered),
          Schedule.recurs(3),
        ),
      )

      const hashToken = (token: Uint8Array): string => toHex(sha256(token))
      const computeExpiry = (n: number) => new Date(n + Duration.toMillis(tokenDuration))

      const rotateToken: RotateTokenUseCaseApi['rotateToken'] = (token) =>
        Effect.gen(function*() {
          const tokenHash = hashToken(token)
          const now = new Date(yield* Clock.currentTimeMillis)

          const rows = yield* Effect.tryPromise(() =>
            db.select()
              .from(schema.refreshTokens)
              .where(eq(schema.refreshTokens.tokenHash, tokenHash))
              .limit(1)
          ).pipe(dbRetry, Effect.orDie)

          if (rows.length === 0) return yield* new RefreshTokenNotFound({})

          const row = rows[0]!

          const cmd = yield* S.encode(ClassifyTokenCommand)(
            ClassifyTokenInput.make({
              revokedAt: row.revokedAt ? Option.some(row.revokedAt) : Option.none(),
              expiresAt: row.expiresAt,
              now,
            }),
          ).pipe(Effect.orDie)
          const action = yield* S.encode(ClassificationToAction)(cmd).pipe(Effect.orDie)

          const revokeFamily = Effect.gen(function*() {
            const familyId = row.familyId ?? row.id
            yield* Effect.tryPromise(() =>
              db.update(schema.refreshTokens)
                .set({ revokedAt: now, revokedReason: 'reuse-detected' })
                .where(eq(schema.refreshTokens.familyId, familyId))
            ).pipe(dbRetry, Effect.orDie)
          })

          yield* Match.value(action).pipe(
            Match.when('reject', () => Effect.fail(new RefreshTokenExpired({}))),
            Match.when('revoke-family', () =>
              Effect.andThen(revokeFamily, () => Effect.fail(new RefreshTokenReuseDetected({})))),
            Match.when('rotate', () =>
              Effect.void),
            Match.exhaustive,
          )

          const rotated = yield* Effect.tryPromise(() =>
            db.transaction(async (tx) => {
              const rows = await tx
                .select()
                .from(schema.refreshTokens)
                .where(eq(schema.refreshTokens.tokenHash, tokenHash))
                .limit(1)
                .for('update')

              const r = rows[0]!

              const newToken = RefreshTokenPlain.make(crypto.getRandomValues(new Uint8Array(32)))
              await tx
                .update(schema.refreshTokens)
                .set({ revokedAt: now, revokedReason: 'rotated' })
                .where(eq(schema.refreshTokens.id, r.id))
              await tx.insert(schema.refreshTokens).values({
                userId: r.userId,
                tokenHash: hashToken(newToken),
                expiresAt: computeExpiry(now.getTime()),
                rotatedFrom: r.id,
                familyId: r.familyId ?? r.id,
              })

              return { newToken, userId: r.userId }
            })
          ).pipe(dbRetry, Effect.orDieWith((cause) => new Error('Failed to rotate refresh token', { cause })))

          const accessToken = yield* jwtAuthService.generateToken({ sub: rotated.userId })
          return new RotatedTokenPair({
            accessToken,
            refreshToken: Redacted.make(rotated.newToken),
          })
        })

      return { rotateToken }
    }),
  )
}
