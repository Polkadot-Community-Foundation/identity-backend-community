import { CandidateAccountId } from '#root/username-registration/registration-queue/entry.schema.js'
import { InsertRegistrationQueueEntrySchema } from '#root/username-registration/registration-queue/store.js'
import { DB } from '@identity-backend/db'
import * as schema from '@identity-backend/db/Schema'
import { Ss58StringFromHex } from '@identity-backend/substrate-schema'
import { Effect, Schema as S } from 'effect'
import { QueueEntryBuilder } from './queue-entry-builder.js'

const queueEntryInsertValues = (builder: QueueEntryBuilder) =>
  Effect.gen(function*() {
    const entry = yield* builder.build()
    const candidateAccountId = yield* S.decode(
      S.compose(Ss58StringFromHex, CandidateAccountId),
    )(entry.candidateAccountId).pipe(Effect.orDie)
    return yield* S.validate(InsertRegistrationQueueEntrySchema)({
      candidateAccountId,
      username: entry.username,
      priorityGroup: entry.priorityGroup,
      network: 'polkadot',
      enqueuedAt: entry.enqueuedAt,
      updatedAt: null,
    })
  })

export const insertQueueEntry = (builder: QueueEntryBuilder, ...builders: ReadonlyArray<QueueEntryBuilder>) =>
  Effect.gen(function*() {
    const db = yield* DB
    const values = yield* Effect.all(
      [builder, ...builders].map(queueEntryInsertValues),
      { concurrency: 'unbounded' },
    )
    const [inserted] = yield* Effect.tryPromise(() =>
      db.insert(schema.registrationQueueEntries)
        .values(values)
        .returning()
    )
    if (!inserted) return yield* Effect.die('insertQueueEntry: no row returned')
    return inserted
  })
