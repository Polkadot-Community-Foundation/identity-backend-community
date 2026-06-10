import { Chunk, Effect, Option, Stream } from 'effect'

export const collectAllPages = <T, E, R>(
  fetch: (cursor: string | undefined) => Effect.Effect<{ items: T[]; nextCursor: string | null }, E, R>,
): Effect.Effect<T[], E, R> =>
  Stream.paginateChunkEffect(undefined as string | undefined, (cursor) =>
    fetch(cursor).pipe(
      Effect.map(({ items, nextCursor }) =>
        [
          Chunk.fromIterable(items),
          nextCursor ? Option.some(nextCursor) : Option.none(),
        ] as const
      ),
    )).pipe(
      Stream.runCollect,
      Effect.map(Chunk.toArray),
    )
