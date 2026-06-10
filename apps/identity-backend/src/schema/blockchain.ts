import { Schema as S } from 'effect'

export const Network = S.Literal('westend2', 'paseo', 'polkadot').pipe(S.brand('Network'))

export type Network = S.Schema.Type<typeof Network>

export * from '@identity-backend/substrate-schema'
