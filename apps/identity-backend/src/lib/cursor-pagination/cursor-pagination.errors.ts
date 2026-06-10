import { Schema as S } from 'effect'

export class CursorDecodeError extends S.TaggedError<CursorDecodeError>()('CursorDecodeError', {
  cursor: S.String,
  cause: S.optional(S.Unknown),
}) {}
