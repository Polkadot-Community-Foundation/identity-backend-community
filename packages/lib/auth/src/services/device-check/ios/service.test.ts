import { afterEach, describe, expect, it, vi } from '@effect/vitest'
import { Effect, Either, Layer } from 'effect'
import { DeviceCheckError, DeviceCheckService } from '../mod.js'
import { DeviceCheckIOSServiceConfig, DeviceCheckIOSServiceWithoutDependencies } from './service.js'

describe('DeviceCheckIOSService', () => {
  const mockQueryTwoBits = vi.fn<DeviceCheckIOSServiceConfig['Type']['queryTwoBits']>()
  const mockUpdateTwoBits = vi.fn<DeviceCheckIOSServiceConfig['Type']['updateTwoBits']>()

  const layer = Layer.provide(
    DeviceCheckIOSServiceWithoutDependencies,
    Layer.succeed(DeviceCheckIOSServiceConfig, {
      queryTwoBits: mockQueryTwoBits,
      updateTwoBits: mockUpdateTwoBits,
    }),
  )

  afterEach(() => {
    vi.clearAllMocks()
  })

  it.layer(layer)((it) => {
    describe('isRegistered', () => {
      it.effect('Should_HandleUndefinedBitState_When_Called', () =>
        Effect.gen(function*() {
          mockQueryTwoBits.mockImplementationOnce(() => Effect.succeed(undefined))

          const service = yield* DeviceCheckService
          const deviceToken = new TextEncoder().encode(crypto.randomUUID())
          const isRegistered = yield* service.isRegistered(deviceToken)

          expect(isRegistered).toBe(false)
          expect(mockQueryTwoBits).toHaveBeenCalledWith(deviceToken)
        }))

      it.effect('Should_HandleQueryErrors_When_Called', () =>
        Effect.gen(function*() {
          const apiError = DeviceCheckError.make({ cause: 'Network timeout' })
          mockQueryTwoBits.mockImplementationOnce(() => Effect.fail(apiError))

          const service = yield* DeviceCheckService

          const deviceToken = new TextEncoder().encode(crypto.randomUUID())
          const result = yield* service.isRegistered(deviceToken).pipe(Effect.either)

          expect(result).toEqual(Either.left(apiError))
          expect(mockQueryTwoBits).toHaveBeenCalledWith(deviceToken)
        }))
    })

    describe('register', () => {
      it.effect('Should_SetCorrectBitPattern_When_AnyDeviceToken', () =>
        Effect.gen(function*() {
          mockUpdateTwoBits.mockImplementationOnce(() => Effect.succeed(undefined))

          const service = yield* DeviceCheckService

          const deviceToken = new TextEncoder().encode(crypto.randomUUID())
          yield* service.register(deviceToken)

          expect(mockUpdateTwoBits).toHaveBeenCalledWith(deviceToken, [false, true])
          expect(mockUpdateTwoBits).toHaveBeenCalledTimes(1)
        }))

      it.effect('Should_HandleUpdateErrors_When_Called', () =>
        Effect.gen(function*() {
          const apiError = DeviceCheckError.make({ cause: 'Device token invalid' })
          mockUpdateTwoBits.mockImplementationOnce(() => Effect.fail(apiError))

          const service = yield* DeviceCheckService

          const deviceToken = new TextEncoder().encode(crypto.randomUUID())
          const result = yield* service.register(deviceToken).pipe(Effect.either)

          expect(result).toEqual(Either.left(apiError))
          expect(mockUpdateTwoBits).toHaveBeenCalledWith(deviceToken, [false, true])
        }))
    })

    describe('reset', () => {
      it.effect('Should_ClearBothBits_When_AnyDeviceToken', () =>
        Effect.gen(function*() {
          mockUpdateTwoBits.mockImplementationOnce(() => Effect.succeed(undefined))

          const service = yield* DeviceCheckService

          const deviceToken = new TextEncoder().encode(crypto.randomUUID())
          yield* service.reset(deviceToken)

          expect(mockUpdateTwoBits).toHaveBeenCalledWith(deviceToken, [false, false])
          expect(mockUpdateTwoBits).toHaveBeenCalledTimes(1)
        }))

      it.effect('Should_PropagateError_When_UpdateFails', () =>
        Effect.gen(function*() {
          const apiError = DeviceCheckError.make({ cause: 'Device token invalid' })
          mockUpdateTwoBits.mockImplementationOnce(() => Effect.fail(apiError))

          const service = yield* DeviceCheckService

          const deviceToken = new TextEncoder().encode(crypto.randomUUID())
          const result = yield* service.reset(deviceToken).pipe(Effect.either)

          expect(result).toEqual(Either.left(apiError))
          expect(mockUpdateTwoBits).toHaveBeenCalledWith(deviceToken, [false, false])
        }))
    })
  })
})
