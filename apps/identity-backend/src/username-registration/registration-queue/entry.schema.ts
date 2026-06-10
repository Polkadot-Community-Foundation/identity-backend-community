import { Schema as S } from 'effect'

import { UsernameDigits } from '#root/schema/username.js'
import { Ss58String } from '@identity-backend/substrate-schema'

export const QueueEntryId = S.Number.pipe(S.brand('QueueEntryId'))
export type QueueEntryId = typeof QueueEntryId.Type

export const CandidateAccountId = Ss58String.pipe(S.brand('CandidateAccountId'))
export type CandidateAccountId = typeof CandidateAccountId.Type

export const Network = S.Literal('westend2', 'paseo', 'polkadot')
export type Network = typeof Network.Type

export const UsernameReservation = S.Struct({
  username: S.String,
  digits: UsernameDigits,
  network: Network,
  candidateAccountId: CandidateAccountId,
})
export type UsernameReservation = typeof UsernameReservation.Type

export class QueueFullError extends S.TaggedError<QueueFullError>()('QueueFullError', {
  capacity: S.Number,
}) {}

export class AlreadyInQueueError extends S.TaggedError<AlreadyInQueueError>()(
  'AlreadyInQueueError',
  {
    candidateAccountId: S.String,
  },
) {}
