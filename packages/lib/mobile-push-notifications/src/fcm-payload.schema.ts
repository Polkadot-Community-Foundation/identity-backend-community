import { Schema as S } from 'effect'
import { NotifyType } from './types.js'

export const StatementFcmPayloadWire = S.Struct({
  statementData: S.propertySignature(S.String).pipe(S.fromKey('statement_data')),
  statementTopic: S.propertySignature(S.String).pipe(S.fromKey('statement_topic')),
  senderPubkey: S.propertySignature(S.String).pipe(S.fromKey('sender_pubkey')),
  notifyType: S.propertySignature(NotifyType).pipe(S.fromKey('notify_type')),
})
export type StatementFcmPayloadWire = S.Schema.Type<typeof StatementFcmPayloadWire>

const FlatFcmPayloadTypeId: unique symbol = Symbol.for('@push/FlatFcmPayload')
export type FlatFcmPayloadTypeId = typeof FlatFcmPayloadTypeId

export class FlatFcmPayload extends S.TaggedClass<FlatFcmPayload>()('FlatFcmPayload', {
  pushType: S.String,
  pushId: S.String,
  message: S.String,
}) {
  readonly [FlatFcmPayloadTypeId] = FlatFcmPayloadTypeId
}
