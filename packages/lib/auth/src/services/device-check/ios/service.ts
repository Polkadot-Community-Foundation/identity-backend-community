import { Context, Effect, Layer } from 'effect'

import { DeviceCheckService } from '../mod.js'
import { DeviceCheckIOSAPIClient } from './api-client.js'

export class DeviceCheckIOSServiceConfig
  extends Context.Tag('@identity-backend/auth/services/device-check/ios/service/DeviceCheckIOSServiceConfig')<
    DeviceCheckIOSServiceConfig,
    {
      queryTwoBits: DeviceCheckIOSAPIClient['queryTwoBits']
      updateTwoBits: DeviceCheckIOSAPIClient['updateTwoBits']
    }
  >()
{}

export const DeviceCheckIOSServiceWithoutDependencies = Layer.effect(
  DeviceCheckService,
  Effect.gen(function*() {
    const { queryTwoBits, updateTwoBits } = yield* DeviceCheckIOSServiceConfig

    const isRegistered = Effect.fn('device_check_ios.is_registered')(
      function*(deviceToken) {
        const bitState = yield* queryTwoBits(deviceToken)
        return bitState !== undefined && (!bitState.bit0 && bitState.bit1)
      },
    ) satisfies DeviceCheckService['Type']['isRegistered']

    const register = Effect.fn('device_check_ios.register')(
      function*(deviceToken) {
        yield* updateTwoBits(deviceToken, [false, true])
      },
    ) satisfies DeviceCheckService['Type']['register']

    const reset = Effect.fn('device_check_ios.reset')(
      function*(deviceToken) {
        yield* updateTwoBits(deviceToken, [false, false])
      },
    ) satisfies DeviceCheckService['Type']['reset']

    return {
      isRegistered,
      register,
      reset,
    } satisfies DeviceCheckService['Type'] as DeviceCheckService['Type']
  }),
)

export const DeviceCheckIOSService = DeviceCheckIOSServiceWithoutDependencies.pipe(
  Layer.provide(Layer.effect(DeviceCheckIOSServiceConfig, DeviceCheckIOSAPIClient)),
  Layer.provide(DeviceCheckIOSAPIClient.Default),
)
