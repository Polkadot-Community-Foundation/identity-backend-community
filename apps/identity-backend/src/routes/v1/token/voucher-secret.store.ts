import { and, eq, isNull } from 'drizzle-orm'
import { createSelectSchema } from 'drizzle-orm/effect-schema'
import { Effect, Option as O, Schema as S } from 'effect'

import { VoucherSecretHash } from '#root/routes/v1/token/voucher-secret.schema.js'
import { DB } from '@identity-backend/db'
import * as schema from '@identity-backend/db/Schema'

export class VoucherSecretStoreError extends S.TaggedError<VoucherSecretStoreError>()(
  'VoucherSecretStoreError',
  {
    cause: S.Unknown,
  },
) {}

export const SelectVoucherSecretSchema = createSelectSchema(schema.voucherSecrets, {
  secretHash: VoucherSecretHash,
  redeemedAt: S.NullOr(S.DateFromSelf),
})
export type SelectVoucherSecret = typeof SelectVoucherSecretSchema.Type

export const insertVoucherSecret = Effect.fn('store.insertVoucherSecret')(function*(
  secretHash: VoucherSecretHash,
) {
  const db = yield* DB
  yield* Effect.tryPromise({
    try: (signal: AbortSignal) => db.insert(schema.voucherSecrets).values({ secretHash }).execute({ signal }),
    catch: (cause) => new VoucherSecretStoreError({ cause }),
  })
})

export const claimVoucher = Effect.fn('store.claimVoucher')(function*(
  secretHash: VoucherSecretHash,
  tx: DB['Type'],
) {
  const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
  const rows = yield* Effect.tryPromise({
    try: (signal: AbortSignal) =>
      tx.update(schema.voucherSecrets)
        .set({ redeemedAt: new Date(now) })
        .where(
          and(
            eq(schema.voucherSecrets.secretHash, secretHash),
            isNull(schema.voucherSecrets.redeemedAt),
          ),
        )
        .returning()
        .execute({ signal }),
    catch: (cause) => new VoucherSecretStoreError({ cause }),
  })

  const row = rows[0]
  if (!row) return O.none<SelectVoucherSecret>()
  const decoded = yield* S.decode(SelectVoucherSecretSchema)(row).pipe(Effect.orDie)
  return O.some(decoded)
})

export const findVoucher = Effect.fn('store.findVoucher')(function*(
  secretHash: VoucherSecretHash,
) {
  const db = yield* DB
  const rows = yield* Effect.tryPromise({
    try: (signal: AbortSignal) =>
      db.select()
        .from(schema.voucherSecrets)
        .where(eq(schema.voucherSecrets.secretHash, secretHash))
        .limit(1)
        .execute({ signal }),
    catch: (cause) => new VoucherSecretStoreError({ cause }),
  })

  const row = rows[0]
  if (!row) return O.none<SelectVoucherSecret>()
  const decoded = yield* S.decode(SelectVoucherSecretSchema)(row).pipe(Effect.orDie)
  return O.some(decoded)
})
