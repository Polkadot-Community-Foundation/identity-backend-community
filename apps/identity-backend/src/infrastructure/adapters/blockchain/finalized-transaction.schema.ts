import { Schema as S } from 'effect'
import type { TxFinalized } from 'polkadot-api'

export const TxHash = S.String.pipe(S.brand('TxHash'))
export type TxHash = S.Schema.Type<typeof TxHash>

export const BlockHash = S.String.pipe(S.brand('BlockHash'))
export type BlockHash = S.Schema.Type<typeof BlockHash>

export const BlockNumber = S.Number.pipe(S.brand('BlockNumber'))
export type BlockNumber = S.Schema.Type<typeof BlockNumber>

export const BlockIndex = S.Number.pipe(S.brand('BlockIndex'))
export type BlockIndex = S.Schema.Type<typeof BlockIndex>

export type ChainEvents = TxFinalized['events']
export const ChainEvents: S.Schema<ChainEvents> = S.declare(
  (input): input is ChainEvents => Array.isArray(input),
)

export interface DispatchError {
  readonly type: string
  readonly value?: DispatchError | undefined
}
export const DispatchError: S.Schema<DispatchError> = S.suspend(() =>
  S.Struct({ type: S.String, value: S.optional(DispatchError) })
)

export class FinalizedBlock extends S.Class<FinalizedBlock>('FinalizedBlock')({
  hash: BlockHash,
  number: BlockNumber,
  index: BlockIndex,
}) {}

export class TransactionIncluded extends S.TaggedClass<TransactionIncluded>()('TransactionIncluded', {
  txHash: TxHash,
  block: FinalizedBlock,
  events: ChainEvents,
}) {}

export class TransactionReverted extends S.TaggedClass<TransactionReverted>()('TransactionReverted', {
  txHash: TxHash,
  block: FinalizedBlock,
  dispatchError: DispatchError,
}) {}

export const FinalizedTransaction = S.Union(TransactionIncluded, TransactionReverted)
export type FinalizedTransaction = TransactionIncluded | TransactionReverted
