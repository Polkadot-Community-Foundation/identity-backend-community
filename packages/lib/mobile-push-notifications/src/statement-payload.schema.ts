import { Schema as S } from 'effect'

const statementApnsInner = S.Struct({
  data: S.NullOr(S.String),
  topic: S.String,
  senderPubkey: S.propertySignature(S.String).pipe(S.fromKey('sender_pubkey')),
})

export const StatementApnsPayloadWire = S.Struct({ statement: statementApnsInner })
export type StatementApnsPayloadWire = S.Schema.Type<typeof StatementApnsPayloadWire>

const FlatApnsPayloadTypeId: unique symbol = Symbol.for('@push/FlatApnsPayload')
export type FlatApnsPayloadTypeId = typeof FlatApnsPayloadTypeId

export class FlatApnsPayload extends S.TaggedClass<FlatApnsPayload>()('FlatApnsPayload', {
  pushId: S.String,
  message: S.String,
}) {
  readonly [FlatApnsPayloadTypeId] = FlatApnsPayloadTypeId
}
