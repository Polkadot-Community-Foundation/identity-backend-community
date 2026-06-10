import { eq, or } from 'drizzle-orm'
import { Effect, Schema as S } from 'effect'

import { AndroidDeviceIdentifiers } from '#root/username-registration/registration-queue/claim.schema.js'
import { CandidateAccountId } from '#root/username-registration/registration-queue/entry.schema.js'
import { DB } from '@identity-backend/db'
import * as schema from '@identity-backend/db/Schema'

export class PoudStoreError extends S.TaggedError<PoudStoreError>()(
  'PoudStoreError',
  {
    cause: S.Unknown,
  },
) {}

export const poudMatch = Effect.fn('store.poudMatch')(function*(
  identifiers: AndroidDeviceIdentifiers,
) {
  const db = yield* DB
  const rows = yield* Effect.tryPromise({
    try: (signal: AbortSignal) =>
      db.select({ id: schema.androidDeviceIdentifiers.id })
        .from(schema.androidDeviceIdentifiers)
        .where(
          or(
            eq(schema.androidDeviceIdentifiers.androidId, identifiers.androidId),
            eq(schema.androidDeviceIdentifiers.widevineId, identifiers.widevineId),
          ),
        )
        .limit(1)
        .execute({ signal }),
    catch: (cause) => new PoudStoreError({ cause }),
  })

  return rows.length > 0
})

export const storePoudIdentifiers = Effect.fn('store.storePoudIdentifiers')(function*(
  identifiers: AndroidDeviceIdentifiers,
  accountId: CandidateAccountId,
) {
  const db = yield* DB
  yield* Effect.tryPromise({
    try: (signal: AbortSignal) =>
      db.insert(schema.androidDeviceIdentifiers)
        .values({
          androidId: identifiers.androidId,
          widevineId: identifiers.widevineId,
          accountId,
        })
        .onConflictDoNothing()
        .execute({ signal }),
    catch: (cause) => new PoudStoreError({ cause }),
  })
})
