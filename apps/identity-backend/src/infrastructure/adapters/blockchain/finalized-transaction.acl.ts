import { Match, Schema as S } from 'effect'
import type { TxFinalized } from 'polkadot-api'
import {
  BlockHash,
  BlockIndex,
  BlockNumber,
  DispatchError,
  FinalizedBlock,
  type FinalizedTransaction,
  TransactionIncluded,
  TransactionReverted,
  TxHash,
} from './finalized-transaction.schema.js'

const decodeDispatchError = S.decodeUnknownSync(DispatchError)

export const finalizedTransactionFromTx = (finalized: TxFinalized): FinalizedTransaction => {
  const txHash = TxHash.make(finalized.txHash)
  const block = new FinalizedBlock({
    hash: BlockHash.make(finalized.block.hash),
    number: BlockNumber.make(finalized.block.number),
    index: BlockIndex.make(finalized.block.index),
  })
  return Match.value(finalized).pipe(
    Match.when({ ok: true }, (included) => new TransactionIncluded({ txHash, block, events: included.events })),
    Match.when(
      { ok: false },
      (reverted) =>
        new TransactionReverted({ txHash, block, dispatchError: decodeDispatchError(reverted.dispatchError) }),
    ),
    Match.exhaustive,
  )
}
