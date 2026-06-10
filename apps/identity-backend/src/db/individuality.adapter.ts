import { individualityUsernames } from '@identity-backend/db/Schema'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/effect-schema'
import { Schema as S } from 'effect'

const OnchainData = S.Struct({
  blockIndex: S.Number.pipe(S.int()),
  blockNumber: S.Number.pipe(S.int()),
  blockHash: S.String,
  eventIndex: S.optional(S.Number.pipe(S.int())),
})

const OnchainDataOrNull = S.Union(OnchainData, S.Null)

export const SelectIndividualityUsernameSchema = createSelectSchema(individualityUsernames, {
  createdAt: () => S.ValidDateFromSelf,
  onchainData: () => OnchainDataOrNull,
  updatedAt: () => S.ValidDateFromSelf,
  signedAt: () => S.NullOr(S.ValidDateFromSelf),
  retryAt: () => S.NullOr(S.ValidDateFromSelf),
  ahRetryAt: () => S.NullOr(S.ValidDateFromSelf),
})

export const SelectIndividualityUsernameWithDigitsSchema = createSelectSchema(individualityUsernames, {
  ...SelectIndividualityUsernameSchema.fields,
  digits: () => S.compose(S.NumberFromString, S.NonNegativeInt),
})

export const InsertIndividualityUsernameSchema = createInsertSchema(individualityUsernames, {
  onchainData: () => OnchainDataOrNull,
})

export const UpdateIndividualityUsernameSchema = createUpdateSchema(individualityUsernames, {
  onchainData: () => OnchainDataOrNull,
})
