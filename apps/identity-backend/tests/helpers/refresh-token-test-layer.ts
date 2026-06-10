import { DB, DBTest } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { ChallengeServiceLive } from '#root/infrastructure/adapters/repositories/challenge.repository.js'
import { AndroidAttestationCrlService } from '#root/infrastructure/android-attestation-crl.service.js'
import { DefectReporter } from '#root/infrastructure/observability/context.js'
import { TokenBucketRateLimiter } from '#root/infrastructure/token-bucket-rate-limiter.service.js'
import { IssueTokenUseCase, RefreshTokenShellConfig } from '#root/jwt/shell/issue-token.use-case.js'
import { JWTAuthService } from '#root/jwt/shell/jwt-auth.service.js'
import { RotateTokenUseCase } from '#root/jwt/shell/rotate-token.use-case.js'
import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { makeRefreshRouteWithoutDependencies, makeTokenRouteWithoutDependencies } from '#root/routes/v1/token/routes.js'
import { AuthService } from '@identity-backend/auth/services'
import { encodeBase64 } from '@std/encoding'
import { eq } from 'drizzle-orm'
import { ConfigProvider, Duration, Effect, Layer, pipe } from 'effect'

import { HTTPException } from 'hono/http-exception'
import { testClient } from 'hono/testing'

export const TOKEN_A = {
  bytes: new Uint8Array(32).fill(0xaa),
  hash: '0xe0e77a507412b120f6ede61f62295b1a7b2ff19d3dcc8f7253e51663470c888e',
  base64: encodeBase64(new Uint8Array(32).fill(0xaa)),
} as const

export const TOKEN_B = {
  bytes: new Uint8Array(32).fill(0xbb),
  hash: '0x4ca14526b2751b640d549ce7caf8ac39438592211a0ec370064d57666a682ad6',
  base64: encodeBase64(new Uint8Array(32).fill(0xbb)),
} as const

export const TOKEN_C = {
  bytes: new Uint8Array(32).fill(0xcc),
  hash: '0xc2f480d4dda9f4522b9f6d590011636d904accfe59f12f9d66a0221c2558e3a2',
  base64: encodeBase64(new Uint8Array(32).fill(0xcc)),
} as const

export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001'
export const FAR_FUTURE = new Date('2099-12-31T00:00:00Z')
export const PAST_DATE = new Date('2020-01-01T00:00:00Z')
export const TEST_NOW = new Date('2025-06-01T00:00:00Z')

export const seedToken = (
  db: DB['Type'],
  overrides: Partial<typeof schema.refreshTokens.$inferInsert> = {},
) =>
  Effect.tryPromise(() =>
    db.transaction(async (tx) => {
      const [row] = await tx.insert(schema.refreshTokens).values({
        userId: DEFAULT_USER_ID,
        tokenHash: TOKEN_A.hash,
        expiresAt: FAR_FUTURE,
        ...overrides,
      }).returning()
      if (!row) throw new Error('seedToken: insert returned no rows')
      await tx.update(schema.refreshTokens)
        .set({ familyId: overrides.familyId ?? row.id })
        .where(eq(schema.refreshTokens.id, row.id))
      return [row] as const
    })
  ).pipe(Effect.orDie)

export const createTokenClient = Effect.gen(function*() {
  const routes = yield* makeTokenRouteWithoutDependencies
  const app = createOpenAPIHono()
    .route('/', routes)
    .onError((err, c) => {
      if (err instanceof HTTPException) return err.getResponse()
      return c.json({ error: 'Internal Server Error' }, 500)
    })
  return testClient(app)
})

export const createRefreshClient = Effect.gen(function*() {
  const routes = yield* makeRefreshRouteWithoutDependencies
  const app = createOpenAPIHono()
    .route('/', routes)
    .onError((err, c) => {
      if (err instanceof HTTPException) return err.getResponse()
      return c.json({ error: 'Internal Server Error' }, 500)
    })
  return testClient(app)
})

const configLayer = Layer.succeed(
  RefreshTokenShellConfig,
  RefreshTokenShellConfig.of({
    tokenDuration: Duration.days(30),
  }),
)

const testConfig = ConfigProvider.fromJson({
  JWT_AUTH_SECRET: 'test-secret-for-refresh-token-integration-tests-min-32-chars',
  ANDROID_PACKAGE_NAMES: [
    'io.pcf.polkadotapp',
    'io.pcf.polkadotapp.debug',
    'io.pcf.polkadotapp.nightly',
  ],
  ANDROID_SIGNING_DIGEST_PLAYSTORE:
    '7B:47:1D:1B:BC:16:F8:FD:81:1F:09:AC:E1:C0:54:1B:A4:62:E6:26:7A:2B:7B:6A:BB:EC:3F:6D:FB:EA:30:61',
  ANDROID_SIGNING_DIGEST_WEBSITE:
    '5A:A3:A6:D7:C8:F2:DE:24:2C:B0:E9:77:62:E2:E5:52:5B:0A:49:89:90:AF:E8:50:63:55:B6:F4:CB:31:27:5C',
})

const crlStub = Layer.succeed(
  AndroidAttestationCrlService,
  AndroidAttestationCrlService.of({ getEntries: Effect.succeed({}) }),
)

const jwtDependencies = Layer.mergeAll(
  AuthService.Default,
  JWTAuthService.Default,
  DBTest,
  configLayer,
)

const routeDependencies = Layer.mergeAll(
  crlStub,
  Layer.provide(ChallengeServiceLive, DBTest),
  TokenBucketRateLimiter.Default,
  DefectReporter.NoOp,
)

export const refreshTokenTestLayer = pipe(
  Layer.mergeAll(
    Layer.provide(IssueTokenUseCase.Default, jwtDependencies),
    Layer.provide(RotateTokenUseCase.Default, jwtDependencies),
    jwtDependencies,
    routeDependencies,
  ),
  Layer.provideMerge(Layer.setConfigProvider(testConfig)),
)
