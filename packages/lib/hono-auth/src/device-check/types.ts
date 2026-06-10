import { Schema as S } from 'effect'

export class DeviceCheckAvailable extends S.TaggedClass<DeviceCheckAvailable>()(
  'DeviceCheckAvailable',
  { deviceToken: S.Uint8ArrayFromSelf },
) {}

export class DeviceCheckAlreadyUsed extends S.TaggedClass<DeviceCheckAlreadyUsed>()(
  'DeviceCheckAlreadyUsed',
  { deviceToken: S.Uint8ArrayFromSelf },
) {}

export class DeviceCheckFailed extends S.TaggedClass<DeviceCheckFailed>()(
  'DeviceCheckFailed',
  { cause: S.Unknown },
) {}

export class DeviceCheckInactive extends S.TaggedClass<DeviceCheckInactive>()(
  'DeviceCheckInactive',
  {},
) {}

export const DeviceCheckState = S.Union(
  DeviceCheckAvailable,
  DeviceCheckAlreadyUsed,
  DeviceCheckFailed,
  DeviceCheckInactive,
)

export type DeviceCheckState = S.Schema.Type<typeof DeviceCheckState>

export const IOS_DEVICE_TOKEN_VAR = 'iosDeviceToken' as const

export type DeviceCheckVariables = {
  readonly [IOS_DEVICE_TOKEN_VAR]: DeviceCheckState
}
