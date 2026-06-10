import type { DB } from '@identity-backend/db'
import { sql } from 'drizzle-orm'
import { Effect, pipe, Schema as S } from 'effect'

export class DatabaseConnectionError extends S.TaggedError<DatabaseConnectionError>()('DatabaseConnectionError', {
  cause: S.Unknown,
}) {}

export const ping = (db: DB.DB) =>
  pipe(
    Effect.tryPromise({
      try: () => db.execute(sql`SELECT 1 WHERE ${1} = 1`),
      catch: (err) => new DatabaseConnectionError({ cause: err }),
    }),
    Effect.andThen(() => Effect.void),
  )
