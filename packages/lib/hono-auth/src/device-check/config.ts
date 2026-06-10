import {
  DeviceCheckIOSApiClientEnvironment,
  DeviceCheckIOSJWTServiceEnvironment,
  DeviceCheckIOSService,
} from '@identity-backend/auth/device-check/ios'
import { Context, type Duration, Effect, Layer } from 'effect'

export class DeviceCheckIOSEnvironment extends Context.Tag('DeviceCheckIOSEnvironment')<
  DeviceCheckIOSEnvironment,
  {
    teamId: string
    keyId: string
    privateKey: CryptoKey
    baseURL: string
    jwtDuration: Duration.Duration
    jwtCacheGracePeriod: Duration.Duration
  }
>() {}

const layerDeviceCheckIOSJWTServiceEnvironment = Layer.effect(
  DeviceCheckIOSJWTServiceEnvironment,
  Effect.gen(function*() {
    const env = yield* DeviceCheckIOSEnvironment
    return {
      getTeamId: () => Effect.succeed(env.teamId),
      getKeyId: () => Effect.succeed(env.keyId),
      getPrivateKey: () => Effect.succeed(env.privateKey),
      getJwtDuration: () => Effect.succeed(env.jwtDuration),
      getJwtCacheGracePeriod: () => Effect.succeed(env.jwtCacheGracePeriod),
    }
  }),
)

const layerDeviceCheckIOSApiClientEnvironment = Layer.effect(
  DeviceCheckIOSApiClientEnvironment,
  Effect.gen(function*() {
    const env = yield* DeviceCheckIOSEnvironment
    return {
      getBaseURL: () => Effect.succeed(env.baseURL),
    }
  }),
)

export const layerDeviceCheckIOSService = DeviceCheckIOSService.pipe(
  Layer.provide(layerDeviceCheckIOSJWTServiceEnvironment),
  Layer.provide(layerDeviceCheckIOSApiClientEnvironment),
)
