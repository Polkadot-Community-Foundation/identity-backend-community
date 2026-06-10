import { and, eq } from 'drizzle-orm'
import { createSelectSchema } from 'drizzle-orm/effect-schema'
import { Effect, Option as O, Schema as S } from 'effect'

import { VoucherKey } from '#root/username-registration/registration-queue/claim.schema.js'
import { DB } from '@identity-backend/db'
import * as schema from '@identity-backend/db/Schema'

export class VoucherStoreError extends S.TaggedError<VoucherStoreError>()(
  'VoucherStoreError',
  {
    cause: S.Unknown,
  },
) {}

export const SelectVoucherSchema = createSelectSchema(schema.lifetimePoudVouchers, {
  key: VoucherKey,
  used: S.Boolean,
  usedAt: S.NullOr(S.DateFromSelf),
  createdAt: S.DateFromSelf,
})
export type SelectVoucher = typeof SelectVoucherSchema.Type

export const findVoucherByKey = Effect.fn('store.findVoucherByKey')(function*(
  key: VoucherKey,
) {
  const db = yield* DB
  const rows = yield* Effect.tryPromise({
    try: (signal: AbortSignal) =>
      db.select()
        .from(schema.lifetimePoudVouchers)
        .where(eq(schema.lifetimePoudVouchers.key, key))
        .limit(1)
        .execute({ signal }),
    catch: (cause) => new VoucherStoreError({ cause }),
  })

  const row = rows[0]
  if (!row) return O.none<SelectVoucher>()
  const decoded = yield* S.decode(SelectVoucherSchema)(row).pipe(Effect.orDie)
  return O.some(decoded)
})

export const markVoucherUsed = Effect.fn('store.markVoucherUsed')(function*(
  key: VoucherKey,
) {
  const db = yield* DB
  const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
  const updated = yield* Effect.tryPromise({
    try: (signal: AbortSignal) =>
      db.update(schema.lifetimePoudVouchers)
        .set({ used: true, usedAt: new Date(now) })
        .where(
          and(
            eq(schema.lifetimePoudVouchers.key, key),
            eq(schema.lifetimePoudVouchers.used, false),
          ),
        )
        .returning({ key: schema.lifetimePoudVouchers.key })
        .execute({ signal }),
    catch: (cause) => new VoucherStoreError({ cause }),
  })

  return updated.length > 0
})
