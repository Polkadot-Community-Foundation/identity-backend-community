import { Schema as S } from 'effect'

export class TransactionSubmitError extends S.TaggedError<TransactionSubmitError>()(
  'TransactionSubmitError',
  {
    cause: S.Unknown,
  },
) {}
