import { DeviceCheckService } from '@identity-backend/auth/services'
import { Effect, Either, Runtime } from 'effect'
import { decodeBase64 } from 'effect/Encoding'
import {
  decideDeviceCheckGate,
  DeviceCheckAlreadyUsed,
  DeviceCheckAvailable,
  type DeviceCheckDecision,
  DeviceCheckFailed,
  DeviceCheckInactive,
} from './gate.workflow.js'

export const DEVICE_CHECK_DECISION_VAR = 'deviceCheckDecision' as const

export type DeviceCheckVariables = {
  readonly [DEVICE_CHECK_DECISION_VAR]: DeviceCheckDecision
}

export const makeDeviceCheckMiddleware = (
  config: { readonly headerName: string; readonly enforceAuth: boolean },
) =>
  Effect.gen(function*() {
    const { createMiddleware } = yield* Effect.promise(() => import('hono/factory'))
    const deviceCheck = yield* DeviceCheckService
    const runtime = yield* Effect.runtime()

    return createMiddleware<{ Variables: DeviceCheckVariables }>(async (c, next) => {
      const verdict = await Effect.gen(function*() {
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

      return Either.match(decideDeviceCheckGate({ verdict, enforced: config.enforceAuth }), {
        onLeft: () => c.json({ error: 'iOS DeviceCheck verification failed' }, 502),
        onRight: (decision) => {
          c.set(DEVICE_CHECK_DECISION_VAR, decision)
          return next()
        },
      })
    })
  })
