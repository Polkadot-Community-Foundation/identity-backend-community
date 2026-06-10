import { DB } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { CursorPaginationService } from '#root/lib/cursor-pagination/mod.js'
import { verifyJwt } from '#root/middleware/verify-jwt.js'
import { makeRegistrationQueueRoute } from '#root/routes/v1/registration-queue.routes.js'
import { SearchUsernamesV1RouteConfig } from '#root/routes/v1/username/search/username-search.config.js'
import { makeSearchUsernamesRouteWithoutDependencies } from '#root/routes/v1/username/search/username-search.routes.js'
import { BalanceCheckConfig, makeBalanceCheckWorker } from '#root/supervision/registration-queue/mod.js'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import { run } from '@identity-backend/effect-daemon-spec'
import { type DaemonHealth } from '@identity-backend/effect-daemon-spec'
import { encodeBase64Url } from '@std/encoding'
import { Context, Duration, Effect, Layer, TestClock } from 'effect'

import { HTTPException } from 'hono/http-exception'
import { Jwt } from 'hono/utils/jwt'

export class ProcessingDaemonHealth extends Context.Tag('ProcessingDaemonHealth')<
  ProcessingDaemonHealth,
  DaemonHealth
>() {}

const TEST_JWT_SECRET = 'identity-backend-test-jwt-secret'

const generateTestJwt = (sub: string): Promise<string> => Jwt.sign({ sub }, TEST_JWT_SECRET, 'HS256')

const generateOfficialStoreJwt = (sub: string): Promise<string> =>
  Jwt.sign({ sub, appFromOfficialStore: true }, TEST_JWT_SECRET, 'HS256')

const ANDROID_DEVICE_TOKEN_HEADER = 'Device-Token-Android'

let deviceNonce = 0
const freshDeviceToken = (account: string): string => {
  deviceNonce += 1
  return encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        androidId: `android-${account}-${deviceNonce}`,
        widevineId: `widevine-${account}-${deviceNonce}`,
      }),
    ),
  )
}

export const makeRegistrationQueueClient = () =>
  Effect.map(makeRegistrationQueueRoute, (honoApp) => {
    const app = new OpenAPIHono()
      .use(verifyJwt(TEST_JWT_SECRET))
      .route('/registration', honoApp)
      .onError((err) => {
        if (err instanceof HTTPException) return err.getResponse()
        throw err
      })
    return app
  })

type MakeClient = ReturnType<typeof makeRegistrationQueueClient>
export type RegistrationQueueApp = [MakeClient] extends [Effect.Effect<infer A, infer _E, infer _R>] ? A : never

const SearchUsernamesResponse = z.object({
  usernames: z.array(z.object({
    username: z.string(),
    status: z.string(),
  })),
})

const QueueStatusObservationResponse = z.object({
  queuePosition: z.number(),
  group: z.number(),
  estimatedIterationsRemaining: z.number(),
})

export interface RegistrationObservation {
  readonly queuePosition: number | null
  readonly visibleStatus: string | null
}

export const enqueueRegistration = (
  app: RegistrationQueueApp,
  account: string,
  username: string,
) =>
  Effect.promise(async () =>
    app.request('/registration', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await generateOfficialStoreJwt(account)}`,
        [ANDROID_DEVICE_TOKEN_HEADER]: freshDeviceToken(account),
      },
      body: JSON.stringify({ username }),
    })
  )

export const getRegistrationStatus = (app: RegistrationQueueApp, accountId: string) =>
  Effect.promise(async () =>
    app.request('/registration/queue', {
      headers: { authorization: `Bearer ${await generateTestJwt(accountId)}` },
    })
  )

export const searchRegisteredUsernames = (prefix: string) =>
  Effect.gen(function*() {
    const route = yield* makeSearchUsernamesRouteWithoutDependencies.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(SearchUsernamesV1RouteConfig, {
            getNetwork: () => Effect.succeed('polkadot' as const),
          }),
          CursorPaginationService.Default,
        ),
      ),
    )
    const app = new OpenAPIHono().route('/', route)
    const res = yield* Effect.promise(async () =>
      await app.request(`/search?prefix=${encodeURIComponent(prefix)}&limit=10`)
    )
    const json = yield* Effect.promise(() => res.json())
    return SearchUsernamesResponse.parse(json)
  })

export const observeRegistration = (
  app: RegistrationQueueApp,
  accountId: string,
  username: string,
) =>
  Effect.gen(function*() {
    const statusRes = yield* getRegistrationStatus(app, accountId)
    let statusQueuePosition: number | null = null
    if (statusRes.status === 200) {
      const json = yield* Effect.promise(() => statusRes.json())
      const parsed = QueueStatusObservationResponse.parse(json)
      statusQueuePosition = parsed.queuePosition
    }
    const searchJson = yield* searchRegisteredUsernames(username)
    const visibleUsername = searchJson.usernames.find((entry) => entry.username.startsWith(`${username}.`))

    return {
      queuePosition: statusQueuePosition,
      visibleStatus: visibleUsername?.status ?? null,
    }
  })

export const cleanUpRegistrationQueue = Effect.andThen(
  DB,
  (db) =>
    Effect.tryPromise(() =>
      db.transaction(async (tx) => {
        await tx.delete(schema.registrationQueueEntries).execute()
        await tx.delete(schema.individualityUsernames).execute()
      })
    ),
).pipe(Effect.orDie)

export const settleRegistrationQueueDaemon = Effect.gen(function*() {
  const health = yield* ProcessingDaemonHealth
  yield* health.ready.close
  yield* TestClock.adjust(Duration.seconds(61))
  yield* Effect.yieldNow()
  yield* health.ready.await
})

export const settleRegistrationQueueBalanceCheck = Effect.gen(function*() {
  yield* BalanceCheckConfig
  const worker = yield* makeBalanceCheckWorker
  yield* Effect.scoped(
    Effect.gen(function*() {
      const health = yield* run.worker(worker)
      yield* health.ready.await
    }),
  )
  yield* Effect.yieldNow()
})
