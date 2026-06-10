import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { createInsertSchema, createSelectSchema } from 'drizzle-orm/effect-schema'
import { Effect, Option as O, Schema as S } from 'effect'

import {
  AlreadyInQueueError,
  CandidateAccountId,
  QueueEntryId,
  UsernameReservation,
} from '#root/username-registration/registration-queue/entry.schema.js'
import { PriorityGroup } from '#root/username-registration/registration-queue/priority-group.schema.js'
import { DB } from '@identity-backend/db'
import * as schema from '@identity-backend/db/Schema'

export const SelectRegistrationQueueEntrySchema = createSelectSchema(schema.registrationQueueEntries, {
  id: QueueEntryId,
  candidateAccountId: CandidateAccountId,
  priorityGroup: PriorityGroup,
  network: S.String,
  enqueuedAt: S.DateFromSelf,
  updatedAt: S.NullOr(S.DateFromSelf),
})

export const InsertRegistrationQueueEntrySchema = createInsertSchema(schema.registrationQueueEntries, {
  candidateAccountId: () => CandidateAccountId,
  priorityGroup: () => PriorityGroup,
  network: () => S.String,
  enqueuedAt: () => S.DateFromSelf,
  updatedAt: () => S.NullOr(S.DateFromSelf),
})

/** Every row is an active queue member; deleting a row is the only exit from the queue. */
export const findQueuedEntries = Effect.fn('store.findQueuedEntries')(function*() {
  const db = yield* DB
  const rows = yield* Effect.tryPromise((signal: AbortSignal) =>
    db.select()
      .from(schema.registrationQueueEntries)
      .orderBy(
        desc(schema.registrationQueueEntries.priorityGroup),
        asc(schema.registrationQueueEntries.enqueuedAt),
      )
      .execute({ signal })
  )
  return yield* S.decodeUnknown(S.Array(SelectRegistrationQueueEntrySchema))(rows)
})

export const findEntryByCandidate = Effect.fn('store.findEntryByCandidate')(function*(
  candidateAccountId: CandidateAccountId,
  network: string,
) {
  const db = yield* DB
  const rows = yield* Effect.tryPromise((signal: AbortSignal) =>
    db.select()
      .from(schema.registrationQueueEntries)
      .where(
        and(
          eq(schema.registrationQueueEntries.candidateAccountId, candidateAccountId),
          eq(schema.registrationQueueEntries.network, network),
        ),
      )
      .orderBy(desc(schema.registrationQueueEntries.enqueuedAt))
      .limit(1)
      .execute({ signal })
  )
  const decoded = yield* S.decodeUnknown(S.Array(SelectRegistrationQueueEntrySchema))(rows)
  return decoded[0] ?? null
})

export const countQueuedEntries = Effect.fn('store.countQueuedEntries')(function*() {
  const db = yield* DB
  const rows = yield* Effect.tryPromise((signal: AbortSignal) =>
    db.select({ value: count() })
      .from(schema.registrationQueueEntries)
      .execute({ signal })
  )
  return rows[0]?.value ?? 0
})

export const insertEntry = Effect.fn('store.insertEntry')(function*(
  values: S.Schema.Encoded<typeof InsertRegistrationQueueEntrySchema>,
) {
  const db = yield* DB
  const validated = yield* S.decode(InsertRegistrationQueueEntrySchema)(values).pipe(Effect.orDie)

  const rows = yield* Effect.tryPromise((signal) =>
    db.insert(schema.registrationQueueEntries)
      .values(validated)
      .onConflictDoNothing()
      .returning()
      .execute({ signal })
  ).pipe(Effect.orDie)

  const entry = rows[0]
  if (!entry) {
    return yield* Effect.fail(
      new AlreadyInQueueError({
        candidateAccountId: validated.candidateAccountId,
      }),
    )
  }

  return yield* S.decode(SelectRegistrationQueueEntrySchema)(entry).pipe(Effect.orDie)
})

export const deleteQueuedEntriesByIds = Effect.fn('store.deleteQueuedEntriesByIds')(function*(
  ids: ReadonlyArray<QueueEntryId>,
) {
  if (ids.length === 0) return 0

  const db = yield* DB
  const deleted = yield* Effect.tryPromise((signal: AbortSignal) =>
    db.delete(schema.registrationQueueEntries)
      .where(inArray(schema.registrationQueueEntries.id, [...ids]))
      .returning({ id: schema.registrationQueueEntries.id })
      .execute({ signal })
  )
  return deleted.length
})

export const insertReservedUsernames = Effect.fn('store.insertReservedUsernames')(function*(
  reservations: ReadonlyArray<UsernameReservation>,
) {
  if (reservations.length === 0) return []

  const values: typeof schema.individualityUsernames.$inferInsert[] = reservations.map((r) => ({
    username: r.username,
    digits: r.digits,
    network: r.network,
    candidateAccountId: r.candidateAccountId,
    candidateSignature: '',
    consumerRegistrationSignature: '',
    ringVrfKey: '',
    proofOfOwnership: '',
    identifierKey: '',
  }))

  const db = yield* DB
  return yield* Effect.tryPromise((signal: AbortSignal) =>
    db.insert(schema.individualityUsernames)
      .values(values)
      .onConflictDoNothing()
      .returning({
        candidateAccountId: schema.individualityUsernames.candidateAccountId,
        username: schema.individualityUsernames.username,
        digits: schema.individualityUsernames.digits,
      })
      .execute({ signal })
  )
})

export const updatePriorityGroups = Effect.fn('store.updatePriorityGroups')(
  function*(updates: ReadonlyArray<{ id: QueueEntryId; priorityGroup: typeof PriorityGroup.Type }>) {
    const db = yield* DB
    for (const { id, priorityGroup } of updates) {
      const validatedPriorityGroup = yield* S.validate(PriorityGroup)(priorityGroup)
      yield* Effect.tryPromise((signal: AbortSignal) =>
        db.update(schema.registrationQueueEntries)
          .set({ priorityGroup: validatedPriorityGroup })
          .where(eq(schema.registrationQueueEntries.id, id))
          .execute({ signal })
      )
    }
  },
)

export const getQueuePosition = Effect.fn('store.getQueuePosition')(function*(
  entryId: QueueEntryId,
) {
  const db = yield* DB

  const queueRanked = db
    .select({
      id: schema.registrationQueueEntries.id,
      position: sql<number>`ROW_NUMBER() OVER (ORDER BY ${desc(schema.registrationQueueEntries.priorityGroup)}, ${
        asc(schema.registrationQueueEntries.enqueuedAt)
      })`.as('position'),
    })
    .from(schema.registrationQueueEntries)
    .as('queue_ranked')

  const rows = yield* Effect.tryPromise((signal: AbortSignal) =>
    db.select({ position: queueRanked.position })
      .from(queueRanked)
      .where(eq(queueRanked.id, entryId))
      .execute({ signal })
  )
  if (rows.length === 0) return O.none()
  return O.some(rows[0]!.position)
})
