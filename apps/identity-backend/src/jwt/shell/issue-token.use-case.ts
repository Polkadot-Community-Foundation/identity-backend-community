import { DB, schema } from '#root/db/mod.js'
import {
  ClientProofVerificationFailedError,
  type IssueTokenCommand,
  RefreshTokenPlain,
  UserId,
} from '#root/jwt/core/jwt.types.js'
import { JWTAuthService } from '#root/jwt/shell/jwt-auth.service.js'
import { AuthService } from '@identity-backend/auth/services'
import { sr25519 } from '@identity-backend/crypto'
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@polkadot-api/utils'
import { encodeBase64 } from '@std/encoding'
import { eq } from 'drizzle-orm'
import { Clock, Context, Duration, Effect, Layer, Redacted, Schedule, Schema as S } from 'effect'

export class RefreshTokenShellConfig
  extends Context.Tag('identity-backend/jwt/shell/refresh-token/RefreshTokenShellConfig')<
    RefreshTokenShellConfig,
    { readonly tokenDuration: Duration.Duration }
  >()
{}

export interface IssueTokenUseCaseApi {
  readonly issueToken: (
    cmd: IssueTokenCommand,
  ) => Effect.Effect<
    { readonly token: string; readonly refreshToken: string },
    ClientProofVerificationFailedError
  >
}

export class IssueTokenUseCase extends Context.Tag('identity-backend/jwt/shell/issue-token/IssueTokenUseCase')<
  IssueTokenUseCase,
  IssueTokenUseCaseApi
>() {
  static readonly Default = Layer.effect(
    IssueTokenUseCase,
    Effect.gen(function*() {
      const db = yield* DB
      const jwtAuthService = yield* JWTAuthService
      const authService = yield* AuthService
      const { tokenDuration } = yield* RefreshTokenShellConfig

      const dbRetry = Effect.retry(
        Schedule.intersect(
          Schedule.exponential(Duration.millis(200), 2).pipe(Schedule.jittered),
          Schedule.recurs(3),
        ),
      )

      const hashToken = (token: Uint8Array): string => toHex(sha256(token))
      const computeExpiry = (n: number) => new Date(n + Duration.toMillis(tokenDuration))

      const insertRefreshToken = Effect.fn('insert_refresh_token')(
        function*(userId: UserId) {
          const token = RefreshTokenPlain.make(crypto.getRandomValues(new Uint8Array(32)))
          const now = yield* Clock.currentTimeMillis

          yield* Effect.tryPromise(() =>
            db.transaction(async (tx) => {
              const rows = await tx
                .insert(schema.refreshTokens)
                .values({ userId, tokenHash: hashToken(token), expiresAt: computeExpiry(now) })
                .returning()
              const inserted = rows[0]!
              await tx
                .update(schema.refreshTokens)
                .set({ familyId: inserted.id })
                .where(eq(schema.refreshTokens.id, inserted.id))
            })
          ).pipe(dbRetry, Effect.orDie)

          yield* Effect.annotateCurrentSpan({ 'db.operation': 'transaction' })

          return Redacted.make(token)
        },
      )

      const issueToken: IssueTokenUseCaseApi['issueToken'] = (cmd) =>
        Effect.gen(function*() {
          const pubkey = yield* S.decodeUnknown(sr25519.PublicKey)(cmd.clientId).pipe(
            Effect.catchAll(() => Effect.fail(new ClientProofVerificationFailedError({}))),
          )

          const proofPayload = yield* authService.buildClientDataHash({
            payload: cmd.body,
            challenge: cmd.challenge,
            clientId: cmd.clientId,
          })

          const verifier = yield* sr25519.fromPublicKey({ publicKey: pubkey })
          const verified = yield* verifier.verify(proofPayload, cmd.clientProof).pipe(
            Effect.catchAll(() => Effect.fail(new ClientProofVerificationFailedError({}))),
          )

          if (!verified) {
            return yield* new ClientProofVerificationFailedError({})
          }

          const clientIdHex = toHex(cmd.clientId)

          let appFromOfficialStore: boolean | undefined
          let platform: 'ios' | 'android' | undefined

          if (cmd.attestationResult !== undefined) {
            appFromOfficialStore = cmd.attestationResult.appFromOfficialStore
            platform = 'android'
          } else if (cmd.iosPackage !== undefined) {
            appFromOfficialStore = true
            platform = 'ios'
          }

          const tokenParams: { sub: string; plt?: 'ios' | 'android'; appFromOfficialStore?: boolean } = {
            sub: clientIdHex,
          }
          if (platform !== undefined) {
            tokenParams.plt = platform
          }
          if (appFromOfficialStore !== undefined) {
            tokenParams.appFromOfficialStore = appFromOfficialStore
          }
          const token = yield* jwtAuthService.generateToken(tokenParams)
          const rt = yield* insertRefreshToken(UserId.make(clientIdHex))

          return { token, refreshToken: encodeBase64(Redacted.value(rt)) }
        })

      return { issueToken }
    }),
  )
}
