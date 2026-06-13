import { Schema as S } from 'effect'

export class AppAttestMiddlewareError extends S.TaggedError<AppAttestMiddlewareError>('AppAttestMiddlewareError')(
  'AppAttestMiddlewareError',
  {
    cause: S.optionalWith(S.Unknown, { nullable: true }),
  },
) {}

export class AppAttestError extends S.TaggedError<AppAttestError>('AppAttestError')(
  'AppAttestError',
  {
    cause: S.Unknown,
    keyId: S.optional(S.String),
  },
) {}

export { ChallengeRejectedError } from '@identity-backend/auth/types'
