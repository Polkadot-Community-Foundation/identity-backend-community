import { DBTest } from '#root/db/drizzle.js'
import { it } from '@effect/vitest'
import { DeviceCheckError, DeviceCheckService } from '@identity-backend/auth/services'
import { ConfigProvider, Effect, Layer } from 'effect'
import { describe, expect, vi } from 'vitest'
import { makeAdminRoute, makeDeviceCheckResetRoute } from '../admin.routes.js'

const isRegistered = vi.fn<DeviceCheckService['Type']['isRegistered']>()
const register = vi.fn<DeviceCheckService['Type']['register']>()
const reset = vi.fn<DeviceCheckService['Type']['reset']>()

const deviceCheckLayer = Layer.succeed(DeviceCheckService, { isRegistered, register, reset })

type AnyHono = {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response
}

const callJson = (app: AnyHono, path: string, body: unknown, extraHeaders: Record<string, string> = {}) =>
  Effect.tryPromise(() =>
    Promise.resolve(app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    }))
  )

describe('admin device-check reset route', () => {
  const buildResetApp = makeDeviceCheckResetRoute.pipe(
    Effect.provide(deviceCheckLayer),
  )

  it.effect('Should_Return200AndCallReset_When_ValidBase64TokenPosted', () =>
    Effect.gen(function*() {
      reset.mockReset()
      reset.mockImplementation(() => Effect.void)

      const app = yield* buildResetApp
      const res = yield* callJson(app, '/reset', { deviceToken: 'YWJj' })

      expect(res.status).toBe(200)
      const body = yield* Effect.promise(() => res.json() as Promise<{ success: boolean }>)
      expect(body).toEqual({ success: true })
      expect(reset).toHaveBeenCalledTimes(1)
      expect(reset.mock.calls[0]![0]).toBeInstanceOf(Uint8Array)
    }))

  it.effect('Should_Return400_When_DeviceTokenFieldMissing', () =>
    Effect.gen(function*() {
      reset.mockReset()

      const app = yield* buildResetApp
      const res = yield* callJson(app, '/reset', {})

      expect(res.status).toBe(400)
      expect(reset).not.toHaveBeenCalled()
    }))

  it.effect('Should_Return400_When_DeviceTokenNotValidBase64', () =>
    Effect.gen(function*() {
      reset.mockReset()

      const app = yield* buildResetApp
      const res = yield* callJson(app, '/reset', { deviceToken: '***not-b64***' })

      expect(res.status).toBe(400)
      expect(reset).not.toHaveBeenCalled()
    }))

  it.effect('Should_Return400_When_DeviceTokenExceedsMaxLength', () =>
    Effect.gen(function*() {
      reset.mockReset()

      const app = yield* buildResetApp
      // 1025 valid-base64 characters — over the 1024 byte cap, but parsable so the
      // length check must fire before base64 decoding.
      const oversized = 'A'.repeat(1025)
      const res = yield* callJson(app, '/reset', { deviceToken: oversized })

      expect(res.status).toBe(400)
      expect(reset).not.toHaveBeenCalled()
    }))

  it.effect('Should_Return502_When_DeviceCheckCallFails', () =>
    Effect.gen(function*() {
      reset.mockReset()
      reset.mockImplementation(() => Effect.fail(DeviceCheckError.make({ cause: 'apple 500' })))

      const app = yield* buildResetApp
      const res = yield* callJson(app, '/reset', { deviceToken: 'YWJj' })

      expect(res.status).toBe(502)
      expect(reset).toHaveBeenCalledTimes(1)
      const body = yield* Effect.promise(() => res.json() as Promise<Record<string, unknown>>)
      // 502 body must not leak upstream cause details into the admin response;
      // the cause is captured on the span instead.
      expect(body).toEqual({ error: 'DeviceCheck API call failed' })
      expect(body).not.toHaveProperty('cause')
    }))
})

describe('admin route gating', () => {
  const adminConfigEntries = (
    resetEnabled: boolean,
    iosEnabled: boolean,
  ): ReadonlyArray<readonly [string, string]> => [
    ['ADMIN_ROUTE_ENABLED', 'true'],
    ['DEVICE_CHECK_RESET_ENABLED', String(resetEnabled)],
    ['DEVICE_CHECK_IOS_ENABLED', String(iosEnabled)],
    ['ADMIN_USERNAME', 'admin'],
    ['ADMIN_PASSWORD', 'secret'],
  ]

  const adminAuthHeader = 'Basic ' + Buffer.from('admin:secret').toString('base64')

  const buildAdminApp = (resetEnabled: boolean, iosEnabled: boolean = true) =>
    makeAdminRoute.pipe(
      Effect.withConfigProvider(ConfigProvider.fromMap(new Map(adminConfigEntries(resetEnabled, iosEnabled)))),
      Effect.provide(Layer.mergeAll(deviceCheckLayer, DBTest)),
    )

  it.effect('Should_Return404_When_ResetFlagDisabled', () =>
    Effect.gen(function*() {
      reset.mockReset()

      const app = yield* buildAdminApp(false)
      const res = yield* callJson(app, '/device-check/reset', { deviceToken: 'YWJj' }, {
        Authorization: adminAuthHeader,
      })

      expect(res.status).toBe(404)
      expect(reset).not.toHaveBeenCalled()
    }))

  it.effect('Should_Return404_When_DeviceCheckIOSDisabled', () =>
    Effect.gen(function*() {
      reset.mockReset()

      // Reset flag is on, but the underlying iOS service is off: mounting the route
      // would let a no-op `reset` return 200 and lie to the operator.
      const app = yield* buildAdminApp(true, false)
      const res = yield* callJson(app, '/device-check/reset', { deviceToken: 'YWJj' }, {
        Authorization: adminAuthHeader,
      })

      expect(res.status).toBe(404)
      expect(reset).not.toHaveBeenCalled()
    }))

  it.effect('Should_RouteMounted_When_ResetFlagEnabled', () =>
    Effect.gen(function*() {
      reset.mockReset()
      reset.mockImplementation(() => Effect.void)

      const app = yield* buildAdminApp(true)
      const res = yield* callJson(app, '/device-check/reset', { deviceToken: 'YWJj' }, {
        Authorization: adminAuthHeader,
      })

      expect(res.status).toBe(200)
      expect(reset).toHaveBeenCalledTimes(1)
    }))
})
