import { DeviceCheckService } from '@identity-backend/auth/services'
import { makeDeviceCheckMiddleware } from '@identity-backend/hono-auth/device-check'
import { Context, Effect, Layer, Option } from 'effect'
import { createMiddleware } from 'hono/factory'

export class DeviceCheckIOSMiddlewareConfig extends Context.Tag('app/DeviceCheckIOSMiddlewareConfig')<
  DeviceCheckIOSMiddlewareConfig,
  { enabled: boolean }
>() {}

export const makeDeviceCheckIOSMiddlewareWithoutDependencies = (headerName: string) =>
  Effect.gen(function*() {
    const config = yield* DeviceCheckIOSMiddlewareConfig

    if (!config.enabled) {
      return createMiddleware(async (_c, next) => next())
    }

    const deviceCheckOption = yield* Effect.serviceOption(DeviceCheckService)
    if (Option.isNone(deviceCheckOption)) {
      return yield* Effect.dieMessage(
        'DeviceCheckService not provided',
      )
    }

    const deviceCheckMiddleware = yield* makeDeviceCheckMiddleware({ headerName }).pipe(
      Effect.provideService(DeviceCheckService, deviceCheckOption.value),
    )

    return deviceCheckMiddleware
  })

export const makeDeviceCheckIOSMiddleware = (headerName: string) =>
  makeDeviceCheckIOSMiddlewareWithoutDependencies(headerName).pipe(
    Effect.provide(
      Layer.effect(
        DeviceCheckIOSMiddlewareConfig,
        Effect.gen(function*() {
          const { DEVICE_CHECK_IOS_ENABLED } = yield* Effect.promise(() => import('#root/config.js'))
          const enabled = yield* DEVICE_CHECK_IOS_ENABLED
          return { enabled }
        }),
      ),
    ),
  )
