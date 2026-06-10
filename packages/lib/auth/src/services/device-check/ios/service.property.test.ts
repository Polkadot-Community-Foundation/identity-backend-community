import { afterEach, describe, expect, it, vi } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { DeviceCheckService } from '../mod.js'
import { DeviceCheckIOSServiceConfig, DeviceCheckIOSServiceWithoutDependencies } from './service.js'
import { BitState } from './types.js'

describe('DeviceCheckIOSService (PBT)', () => {
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
      it.effect.prop(
        '∀x_RegistrationStatus_≡Expected',
        [BitState],
        ([bitState]) =>
          Effect.gen(function*() {
            mockQueryTwoBits.mockImplementationOnce(() => Effect.succeed(bitState))

            const service = yield* DeviceCheckService

            const deviceToken = new TextEncoder().encode(crypto.randomUUID())
            const isRegistered = yield* service.isRegistered(deviceToken)

            expect(mockQueryTwoBits).toHaveBeenLastCalledWith(deviceToken)

            const expectedResult = !bitState.bit0 && bitState.bit1
            expect(isRegistered).toBe(expectedResult)
          }),
      )
    })
  })
})
