import {
  DeviceCheckIOSMiddlewareConfig,
  makeDeviceCheckIOSMiddlewareWithoutDependencies,
} from '#root/middleware/auth/device-check.js'
import { it } from '@effect/vitest'
import { DEVICE_CHECK_DECISION_VAR, type DeviceCheckVariables } from '@identity-backend/hono-auth/device-check'
import { Effect, Layer, Match, Option } from 'effect'
import { Hono } from 'hono'
import { describe, expect } from 'vitest'

const TEST_HEADER = 'Device-Token-iOS'

describe('makeDeviceCheckIOSMiddleware disabled path', () => {
  const layer = Layer.succeed(DeviceCheckIOSMiddlewareConfig, { enabled: false, enforceAuth: false })

  it.layer(layer)((it) => {
    it.effect('Should_SetProceedWithoutAdvisory_When_Disabled', () =>
      Effect.gen(function*() {
        const middleware = yield* makeDeviceCheckIOSMiddlewareWithoutDependencies(TEST_HEADER)

        const app = new Hono<{ Variables: DeviceCheckVariables }>()
          .use(middleware)
          .post('/test', (c) => {
            const decision = c.get(DEVICE_CHECK_DECISION_VAR)
            return c.json({
              kind: decision._tag,
              advisory: Match.value(decision).pipe(
                Match.tag('DeviceCheckProceed', (proceed) => Option.getOrNull(proceed.available)),
                Match.orElse(() => 'unexpected' as const),
              ),
            })
          })

        const res = yield* Effect.promise(() => Promise.resolve(app.request('/test', { method: 'POST' })))

        expect(res.status).toBe(200)
        expect(yield* Effect.promise(() => res.json())).toEqual({ kind: 'DeviceCheckProceed', advisory: null })
      }))
  })
})
