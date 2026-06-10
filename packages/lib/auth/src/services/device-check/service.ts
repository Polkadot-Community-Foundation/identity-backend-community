import { Context, Effect } from 'effect'
import type { DeviceCheckError } from './types.js'

export class DeviceCheckService
  extends Context.Tag('@identity-backend/auth/services/device-check/mod/DeviceCheckService')<DeviceCheckService, {
    readonly isRegistered: (deviceToken: Uint8Array) => Effect.Effect<boolean, DeviceCheckError>
    readonly register: (deviceToken: Uint8Array) => Effect.Effect<void, DeviceCheckError>
    readonly reset: (deviceToken: Uint8Array) => Effect.Effect<void, DeviceCheckError>
  }>()
{}
