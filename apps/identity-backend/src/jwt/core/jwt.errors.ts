import { Schema as S } from 'effect'

export class RefreshTokenExpired extends S.TaggedError<RefreshTokenExpired>()('RefreshTokenExpired', {}) {}

export class RefreshTokenNotFound extends S.TaggedError<RefreshTokenNotFound>()('RefreshTokenNotFound', {}) {}

export class RefreshTokenReuseDetected extends S.TaggedError<RefreshTokenReuseDetected>()(
  'RefreshTokenReuseDetected',
  {},
) {}
