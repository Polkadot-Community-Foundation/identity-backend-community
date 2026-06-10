import { Schema as S } from 'effect'

export class PersistChallengeError
  extends S.TaggedError<PersistChallengeError>('PersistChallengeError')('PersistChallengeError', {
    cause: S.optionalWith(S.Unknown, { nullable: true }),
  })
{}

export class ConsumeChallengeError
  extends S.TaggedError<ConsumeChallengeError>('ConsumeChallengeError')('ConsumeChallengeError', {
    cause: S.optionalWith(S.Unknown, { nullable: true }),
  })
{}

export class ChallengeNotFoundError
  extends S.TaggedError<ChallengeNotFoundError>('ChallengeNotFoundError')('ChallengeNotFoundError', {
    cause: S.optionalWith(S.Unknown, { nullable: true }),
  })
{}
