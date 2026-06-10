import { Ss58String } from '@identity-backend/substrate-schema'
import { Arbitrary, pipe, Schema as S } from 'effect'

const validSs58Arbitrary = () => () => Arbitrary.make(Ss58String)

// #region Value Objects

export const InviterAddress = pipe(
  Ss58String,
  S.annotations({ identifier: 'InviterAddress', arbitrary: validSs58Arbitrary }),
  S.brand('InviterAddress'),
)
export type InviterAddress = S.Schema.Type<typeof InviterAddress>

export const InviteeAddress = pipe(
  Ss58String,
  S.annotations({ identifier: 'InviteeAddress', arbitrary: validSs58Arbitrary }),
  S.brand('InviteeAddress'),
)
export type InviteeAddress = S.Schema.Type<typeof InviteeAddress>

export const DIMLiteral = S.Literal('Game', 'ProofOfInk')
export type DIMLiteral = S.Schema.Type<typeof DIMLiteral>

export const NetworkLiteral = S.Literal('westend2', 'paseo', 'polkadot')
export type NetworkLiteral = S.Schema.Type<typeof NetworkLiteral>

// #endregion

// #region Storage Record

const JsonSafeUnknown = S.Unknown.pipe(
  S.annotations({
    arbitrary: () => (fc) => fc.jsonValue(),
  }),
)

export const DimTicketRecord = S.Struct({
  ticket: InviteeAddress,
  inviter: InviterAddress,
  network: NetworkLiteral,
  dim: DIMLiteral,
  status: S.Literal('PENDING', 'SUBMITTING', 'SUBMITTED', 'REGISTERED', 'FAILED'),
  retryCount: S.NullOr(S.Int),
  retryAt: S.NullOr(S.ValidDateFromSelf),
  onchainData: JsonSafeUnknown,
  createdAt: S.ValidDateFromSelf,
  updatedAt: S.optionalWith(S.ValidDateFromSelf, { nullable: true }),
})
export type DimTicketRecord = S.Schema.Type<typeof DimTicketRecord>

// #endregion

// #region Aggregates (Ticket State Machine)

const TicketIdentity = S.Struct({
  ticket: InviteeAddress,
  inviter: InviterAddress,
})

const TicketMetadata = S.Struct({
  dim: DIMLiteral,
  network: NetworkLiteral,
  createdAt: S.ValidDateFromSelf,
})

const SubmittedAt = S.Struct({
  submittedAt: S.ValidDateFromSelf,
  retryAt: S.optional(S.ValidDateFromSelf),
})

const RetryAt = S.Struct({
  retryAt: S.optional(S.ValidDateFromSelf),
})

const RegisteredInfo = S.Struct({
  onchainData: JsonSafeUnknown,
  registeredAt: S.ValidDateFromSelf,
})

const FailedInfo = S.Struct({
  error: S.Literal('Failed'),
  failedAt: S.ValidDateFromSelf,
})

const PendingTicketTypeId: unique symbol = Symbol.for('@identity-backend/PendingTicket')
export type PendingTicketTypeId = typeof PendingTicketTypeId

export class PendingTicket extends S.TaggedClass<PendingTicket>()('PendingTicket', {
  ...TicketIdentity.fields,
  ...TicketMetadata.fields,
}) {
  readonly [PendingTicketTypeId] = PendingTicketTypeId
}

const SubmittingTicketTypeId: unique symbol = Symbol.for('@identity-backend/SubmittingTicket')
export type SubmittingTicketTypeId = typeof SubmittingTicketTypeId

export class SubmittingTicket extends S.TaggedClass<SubmittingTicket>()('SubmittingTicket', {
  ...TicketIdentity.fields,
  ...TicketMetadata.fields,
  submittedAt: S.ValidDateFromSelf,
}) {
  readonly [SubmittingTicketTypeId] = SubmittingTicketTypeId
}

const SubmittedTicketTypeId: unique symbol = Symbol.for('@identity-backend/SubmittedTicket')
export type SubmittedTicketTypeId = typeof SubmittedTicketTypeId

export class SubmittedTicket extends S.TaggedClass<SubmittedTicket>()('SubmittedTicket', {
  ...TicketIdentity.fields,
  ...TicketMetadata.fields,
  ...SubmittedAt.fields,
}) {
  readonly [SubmittedTicketTypeId] = SubmittedTicketTypeId
}

const RegisteredTicketTypeId: unique symbol = Symbol.for('@identity-backend/RegisteredTicket')
export type RegisteredTicketTypeId = typeof RegisteredTicketTypeId

export class RegisteredTicket extends S.TaggedClass<RegisteredTicket>()('RegisteredTicket', {
  ...TicketIdentity.fields,
  ...TicketMetadata.fields,
  ...RetryAt.fields,
  ...RegisteredInfo.fields,
}) {
  readonly [RegisteredTicketTypeId] = RegisteredTicketTypeId
}

const FailedTicketTypeId: unique symbol = Symbol.for('@identity-backend/FailedTicket')
export type FailedTicketTypeId = typeof FailedTicketTypeId

export class FailedTicket extends S.TaggedClass<FailedTicket>()('FailedTicket', {
  ...TicketIdentity.fields,
  ...TicketMetadata.fields,
  ...FailedInfo.fields,
}) {
  readonly [FailedTicketTypeId] = FailedTicketTypeId
}

export const DimTicketStatus = S.Union(
  PendingTicket,
  SubmittingTicket,
  SubmittedTicket,
  RegisteredTicket,
  FailedTicket,
)
export type DimTicketStatus = S.Schema.Type<typeof DimTicketStatus>

// #endregion

// #region Encodable Types (record-shaped with ALL storage fields)

// DB stores a single status='FAILED' regardless of which state the ticket failed from.

const TicketBaseFields = S.Struct({
  ticket: InviteeAddress,
  inviter: InviterAddress,
  network: NetworkLiteral,
  dim: DIMLiteral,
  retryCount: S.NullOr(S.Int),
  retryAt: S.NullOr(S.ValidDateFromSelf),
  onchainData: JsonSafeUnknown,
  createdAt: S.ValidDateFromSelf,
  updatedAt: S.optionalWith(S.ValidDateFromSelf, { nullable: true }),
})

const PendingTicketRecord = S.Struct({
  ...TicketBaseFields.fields,
  status: S.Literal('PENDING'),
}).pipe(S.attachPropertySignature('_tag', 'PendingTicketRecord'))

const SubmittingTicketRecord = S.Struct({
  ...TicketBaseFields.fields,
  status: S.Literal('SUBMITTING'),
}).pipe(S.attachPropertySignature('_tag', 'SubmittingTicketRecord'))

const SubmittedTicketRecord = S.Struct({
  ...TicketBaseFields.fields,
  status: S.Literal('SUBMITTED'),
}).pipe(S.attachPropertySignature('_tag', 'SubmittedTicketRecord'))

const RegisteredTicketRecord = S.Struct({
  ...TicketBaseFields.fields,
  status: S.Literal('REGISTERED'),
}).pipe(S.attachPropertySignature('_tag', 'RegisteredTicketRecord'))

const FailedTicketRecord = S.Struct({
  ...TicketBaseFields.fields,
  status: S.Literal('FAILED'),
}).pipe(S.attachPropertySignature('_tag', 'FailedTicketRecord'))

export const EncodableDimTicketStatus = S.Union(
  PendingTicketRecord,
  SubmittingTicketRecord,
  SubmittedTicketRecord,
  RegisteredTicketRecord,
  FailedTicketRecord,
)
export type EncodableDimTicketStatus = S.Schema.Type<typeof EncodableDimTicketStatus>

// #endregion

// #region Errors

export class DimTicketInviterMatchesTicketError extends S.TaggedError<DimTicketInviterMatchesTicketError>()(
  'DimTicketInviterMatchesTicketError',
  {
    ticket: S.String,
    inviter: S.String,
  },
) {}

// #endregion

// #region Blockchain ACL Result

export class BatchRegistrationResult extends S.TaggedClass<BatchRegistrationResult>()(
  'BatchRegistrationResult',
  {
    completedIndices: S.Array(S.Number),
    failedIndices: S.Array(S.Number),
    blockHash: S.String,
    blockNumber: S.Number,
  },
) {}

// #endregion
