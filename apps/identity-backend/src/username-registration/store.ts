import { and, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import { DB } from '@identity-backend/db'
import * as schema from '@identity-backend/db/Schema'

export const getAllocatedDigits = Effect.fn('username-registration.getAllocatedDigits')(function*(
  usernames: ReadonlyArray<string>,
  network: 'westend2' | 'paseo' | 'polkadot',
) {
  const db = yield* DB

  const rows = yield* Effect.tryPromise((signal: AbortSignal) =>
    db.select({ username: schema.individualityUsernames.username, digits: schema.individualityUsernames.digits })
      .from(schema.individualityUsernames)
      .where(
        and(
          inArray(schema.individualityUsernames.username, usernames),
          eq(schema.individualityUsernames.network, network),
        ),
      )
      .execute({ signal })
  )

  const allocated = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = allocated.get(row.username) ?? new Set()
    set.add(row.digits)
    allocated.set(row.username, set)
  }
  return allocated
})
