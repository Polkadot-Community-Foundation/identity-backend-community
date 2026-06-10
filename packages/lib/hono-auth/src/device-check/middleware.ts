import { DeviceCheckService } from '@identity-backend/auth/services'
import { Effect, Either, Runtime } from 'effect'

import { decodeBase64 } from 'effect/Encoding'
import {
  DeviceCheckAlreadyUsed,
  DeviceCheckAvailable,
  DeviceCheckFailed,
  DeviceCheckInactive,
  type DeviceCheckVariables,
  IOS_DEVICE_TOKEN_VAR,
} from './types.js'

export const makeDeviceCheckMiddleware = (config: { readonly headerName: string }) =>
  Effect.gen(function*() {
    const { createMiddleware } = yield* Effect.promise(() => import('hono/factory'))
    const deviceCheck = yield* DeviceCheckService
    const runtime = yield* Effect.runtime()

    return createMiddleware<{ Variables: DeviceCheckVariables }>(async (c, next) => {
      const outcome = await Effect.gen(function*() {
        const deviceToken = c.req.header(config.headerName)
        if (!deviceToken) return new DeviceCheckInactive({})

        const decoded = decodeBase64(deviceToken)
        if (Either.isLeft(decoded)) return new DeviceCheckInactive({})

        const isRegistered = yield* deviceCheck.isRegistered(decoded.right)
        if (isRegistered) return new DeviceCheckAlreadyUsed({ deviceToken: decoded.right })

        return new DeviceCheckAvailable({ deviceToken: decoded.right })
      }).pipe(
        Effect.catchAllCause((cause) => Effect.succeed(new DeviceCheckFailed({ cause }))),
        Runtime.runPromise(runtime),
      )

      c.set(IOS_DEVICE_TOKEN_VAR, outcome)
      return await next()
    })
  })
