import { Schema as S } from 'effect'

export class AppAttestError extends S.TaggedError<AppAttestError>('AppAttestError')('AppAttestError', {
  cause: S.optionalWith(S.Unknown, { nullable: true }),
}) {}
