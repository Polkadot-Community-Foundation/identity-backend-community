import {
  ADMIN_PASSWORD,
  ADMIN_ROUTE_ENABLED,
  ADMIN_USERNAME,
  DEVICE_CHECK_IOS_ENABLED,
  DEVICE_CHECK_RESET_ENABLED,
} from '#root/config.js'
import { DB } from '#root/db/drizzle.js'
import { individualityUsernames, invitationTickets } from '#root/db/schema.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { DeviceCheckService } from '@identity-backend/auth/services'
import { bridgeSpanContext } from '@identity-backend/observability'
import { Cause, Clock, Config, Effect, Either, Exit, Option, Redacted, Runtime, Schedule } from 'effect'
import { decodeBase64 } from 'effect/Encoding'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'

const makeNukeRoutes = Effect.gen(function* makeNukeRoutes() {
  const db = yield* DB
  const runtime = yield* Effect.runtime()

  const dropUsernameRows = Effect.fn('drop_username_rows')(() =>
    Effect.tryPromise(() =>
      db.delete(individualityUsernames)
        .returning({ username: individualityUsernames.username })
        .execute()
    ).pipe(
      Effect.retry(Schedule.exponential('100 millis', 2)),
      Effect.timeout('60 seconds'),
    )
  )

  const dropInvitationTickets = Effect.fn('drop_invitation_tickets')(() =>
    Effect.tryPromise(() =>
      db.delete(invitationTickets)
        .returning({ publicKey: invitationTickets.publicKey })
        .execute()
    ).pipe(
      Effect.retry(Schedule.exponential('100 millis', 2)),
      Effect.timeout('60 seconds'),
    )
  )

  return new Hono()
    .post('/', async (c) => {
      const handler = Effect.Do.pipe(
        Effect.bind('deletedUsernames', dropUsernameRows),
        Effect.bind('deletedTickets', dropInvitationTickets),
        Effect.let('deletedCounts', ({ deletedUsernames, deletedTickets }) => ({
          usernames: deletedUsernames.length,
          invitationTickets: deletedTickets.length,
        })),
        Effect.bind('timestamp', () => Clock.currentTimeMillis.pipe(Effect.map((ms) => new Date(ms)))),
        Effect.withSpan('admin_nuke_operation'),
      )

      const result = await bridgeSpanContext(handler, c).pipe(
        Effect.map(({ deletedCounts, timestamp }) =>
          c.json({
            success: true,
            deletedCounts,
            timestamp,
          }, 200)
        ),
        withRouteTimeout,
        Effect.exit,
        Runtime.runPromise(runtime),
      )

      if (Exit.isFailure(result)) {
        throw Cause.squash(result.cause)
      }

      return result.value
    })
})

export const makeDeviceCheckResetRoute = Effect.gen(function* makeDeviceCheckResetRoute() {
  const deviceCheckOption = yield* Effect.serviceOption(DeviceCheckService)
  if (Option.isNone(deviceCheckOption)) {
    return yield* Effect.dieMessage(
      'makeDeviceCheckResetRoute called when DEVICE_CHECK_IOS_ENABLED=false',
    )
  }
  const deviceCheck = deviceCheckOption.value
  const runtime = yield* Effect.runtime()

  // Apple device tokens are ~40 bytes; cap base64 input well above that to bound
  // work before decode.
  const MAX_DEVICE_TOKEN_LENGTH = 1024

  return new Hono()
    .post('/reset', async (c) => {
      const body = await c.req.json<{ deviceToken?: unknown }>().catch(() => null)

      if (body === null || typeof body.deviceToken !== 'string' || body.deviceToken.length === 0) {
        return c.json({ error: 'Missing or invalid "deviceToken" field' }, 400)
      }

      if (body.deviceToken.length > MAX_DEVICE_TOKEN_LENGTH) {
        return c.json({ error: '"deviceToken" exceeds maximum length' }, 400)
      }

      const decoded = decodeBase64(body.deviceToken)
      if (Either.isLeft(decoded)) {
        return c.json({ error: '"deviceToken" is not valid base64' }, 400)
      }

      const handler = deviceCheck.reset(decoded.right).pipe(
        Effect.tapErrorTag(
          'DeviceCheckError',
          (err) => Effect.annotateCurrentSpan({ 'device_check.error_cause': String(err.cause) }),
        ),
        Effect.withSpan('admin_device_check_reset'),
      )

      const result = await bridgeSpanContext(handler, c).pipe(
        Effect.map(() => c.json({ success: true }, 200)),
        Effect.catchTag(
          'DeviceCheckError',
          () => Effect.succeed(c.json({ error: 'DeviceCheck API call failed' }, 502)),
        ),
        withRouteTimeout,
        Effect.exit,
        Runtime.runPromise(runtime),
      )

      if (Exit.isFailure(result)) {
        throw Cause.squash(result.cause)
      }

      return result.value
    })
})

const makeAdminRoutes = Effect.gen(function* makeAdminRoutes() {
  const [username, password] = yield* Config.all([ADMIN_USERNAME, ADMIN_PASSWORD])
  // Reset is only meaningful when the real iOS DeviceCheck service is wired up.
  // Without that, the default Layer.succeed `reset` is a no-op and a 200 would
  // silently lie to the operator. Require both flags to be true to mount.
  const [deviceCheckResetEnabled, deviceCheckIOSEnabled] = yield* Config.all([
    DEVICE_CHECK_RESET_ENABLED,
    DEVICE_CHECK_IOS_ENABLED,
  ])

  const nukeRoute = yield* makeNukeRoutes

  const admin = new Hono()
    .use('/nuke/*', basicAuth({ username, password: Redacted.value(password) }))
    .route('/nuke', nukeRoute)

  if (deviceCheckResetEnabled && deviceCheckIOSEnabled) {
    const deviceCheckResetRoute = yield* makeDeviceCheckResetRoute
    admin.route('/device-check', deviceCheckResetRoute)
  }

  return admin
})

export const makeAdminRoute = Effect.gen(function* makeAdminRoute() {
  const enabled = yield* ADMIN_ROUTE_ENABLED

  if (!enabled) {
    const empty: Effect.Effect.Success<typeof makeAdminRoutes> = new Hono()
    return empty
  }

  return yield* makeAdminRoutes
})
