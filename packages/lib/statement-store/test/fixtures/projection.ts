import { statementCodec } from '@novasamatech/sdk-statement'
import { Blake2256 } from '@polkadot-api/substrate-bindings'
import { toHex } from '@polkadot-api/utils'
import type { VerifiedStatement } from '../../src/index.js'
import type { SignedStatementFixture } from './signed-statement-builder.js'

export interface ProjectionComparable {
  readonly statementHash: string
  readonly statementData: string
  readonly topics: readonly string[]
  readonly senderPubkey: string
  readonly signature: string
  readonly channel: string | null
  readonly expiry: string | null
}

export const projectionComparable = (
  projection: Omit<ProjectionComparable, 'expiry'> & { readonly expiry: bigint | null },
): ProjectionComparable => ({
  ...projection,
  expiry: projection.expiry === null ? null : projection.expiry.toString(),
})

export const projectVerified = (
  vs: VerifiedStatement,
): Omit<ProjectionComparable, 'expiry'> & { expiry: bigint | null } => ({
  statementHash: vs.statementHash,
  statementData: toHex(vs.data),
  topics: [...vs.topics],
  senderPubkey: vs.proofSigner,
  signature: vs.signature,
  channel: vs.channel,
  expiry: vs.expiry,
})

export const projectComparable = (vs: VerifiedStatement): ProjectionComparable =>
  projectionComparable(projectVerified(vs))

export const expectedProjection = (signed: SignedStatementFixture): ProjectionComparable =>
  projectionComparable({
    statementHash: toHex(Blake2256(statementCodec.enc(signed.raw))),
    statementData: toHex(signed.data),
    topics: [...signed.topics],
    senderPubkey: toHex(signed.signerPubkey),
    signature: signed.signature,
    channel: signed.channel,
    expiry: signed.expiry,
  })
