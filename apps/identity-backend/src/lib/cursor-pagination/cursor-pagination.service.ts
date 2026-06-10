import { Effect, Schema as S } from 'effect'
import { encodeBase64Url } from 'effect/Encoding'
import { CursorDecodeError } from './cursor-pagination.errors.js'
import { CursorToken } from './cursor-pagination.types.js'

export namespace CursorPaginationService {
  export type VerifyError = CursorDecodeError

  export interface Shape {
    sign: <Type, Encoded>(payload: Type, schema: S.Schema<Type, Encoded, never>) => Effect.Effect<CursorToken, never>
    verify: <Type, Encoded>(
      cursor: string,
      schema: S.Schema<Type, Encoded, never>,
    ) => Effect.Effect<Type, VerifyError>
  }
}

export class CursorPaginationService extends Effect.Service<CursorPaginationService>()(
  'identity-backend-container/lib/cursor-pagination/cursor-pagination.service/CursorPaginationService',
  {
    effect: Effect.succeed(
      {
        sign: Effect.fn('cursor_pagination.sign')(
          function*<Type, Encoded>(payload: Type, schema: S.Schema<Type, Encoded>) {
            const encoded = yield* S.encode(S.parseJson(schema))(payload).pipe(Effect.orDie)
            return CursorToken.make(encodeBase64Url(new TextEncoder().encode(encoded)))
          },
        ) satisfies CursorPaginationService.Shape['sign'] as CursorPaginationService.Shape['sign'],

        verify: Effect.fn('cursor_pagination.verify')(
          function*<Type, Encoded>(cursor: string, schema: S.Schema<Type, Encoded>) {
            const jsonString = yield* S.decode(CursorToken)(cursor).pipe(
              Effect.mapError((cause) => new CursorDecodeError({ cursor, cause })),
            )
            const decoded = yield* S.decode(S.parseJson(schema))(jsonString).pipe(
              Effect.mapError((cause) => new CursorDecodeError({ cursor, cause })),
            )
            return decoded
          },
        ) satisfies CursorPaginationService.Shape['verify'] as CursorPaginationService.Shape['verify'],
      } satisfies CursorPaginationService.Shape as CursorPaginationService.Shape,
    ),
    dependencies: [],
  },
) {}
