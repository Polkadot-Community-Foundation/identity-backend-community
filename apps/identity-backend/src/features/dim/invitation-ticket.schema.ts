import { Schema as S } from 'effect'
export { Ss58String } from '@identity-backend/substrate-schema'
import { Ss58String } from '@identity-backend/substrate-schema'

export const Dim = S.Literal('Game', 'ProofOfInk')
export type Dim = S.Schema.Type<typeof Dim>

export const Network = S.Literal('westend2', 'polkadot', 'paseo')
export type Network = S.Schema.Type<typeof Network>

export const TicketState = S.Literal('unclaimed_off_chain', 'unclaimed_on_chain', 'claimed')
export type TicketState = S.Schema.Type<typeof TicketState>

export const TicketAddress = Ss58String.pipe(S.brand('TicketAddress'))
export type TicketAddress = typeof TicketAddress.Type
