import { Schema as S } from 'effect'
import { PublicKey, Topic } from './types.js'

export const AddRulesRequestSchema = S.Struct({
  rules: S.Array(
    S.Struct({
      senderPubkey: PublicKey,
      topic: Topic,
    }),
  ),
})
export type AddRulesRequest = S.Schema.Type<typeof AddRulesRequestSchema>

export const DeleteRulesRequestSchema = S.Struct({
  rules: S.Array(
    S.Struct({
      senderPubkey: PublicKey,
      topic: Topic,
    }),
  ),
})
export type DeleteRulesRequest = S.Schema.Type<typeof DeleteRulesRequestSchema>

export const ReplaceRulesRequestSchema = S.Struct({
  rules: S.Array(
    S.Struct({
      senderPubkey: PublicKey,
      topic: Topic,
    }),
  ),
})
export type ReplaceRulesRequest = S.Schema.Type<typeof ReplaceRulesRequestSchema>
