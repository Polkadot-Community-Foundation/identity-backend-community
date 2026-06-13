import { Schema as S } from 'effect'

export const ChainId = S.String.pipe(S.brand('ChainId'))
export type ChainId = S.Schema.Type<typeof ChainId>

export const SignerPublicKey = S.String.pipe(S.brand('SignerPublicKey'))
export type SignerPublicKey = S.Schema.Type<typeof SignerPublicKey>

export const SubmissionKey = S.Data(S.Struct({ chain: ChainId, account: SignerPublicKey }))
export type SubmissionKey = S.Schema.Type<typeof SubmissionKey>
