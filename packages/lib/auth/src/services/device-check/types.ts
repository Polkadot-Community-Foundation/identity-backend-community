import { Schema as S } from 'effect'

export class DeviceCheckError extends S.TaggedError<DeviceCheckError>('DeviceCheckError')('DeviceCheckError', {
  cause: S.optionalWith(S.Unknown, { nullable: true }),
}) {}
