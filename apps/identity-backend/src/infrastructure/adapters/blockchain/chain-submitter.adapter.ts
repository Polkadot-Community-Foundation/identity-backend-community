import { TransactionSubmitError } from '#root/data/mod.js'
import { fromObservable } from '@identity-backend/rx-effect'
import {
  logTxEvent,
  runTxFinalized,
  type TxBestBlockNotIncludedError,
  type TxFinalizationError,
  type TxInclusionTimeoutError,
  watchThroughReorgs,
} from '@identity-backend/tx-events'
import { toHex } from '@polkadot-api/utils'
import { Context, Duration, Effect, Layer, Schema as S, Stream } from 'effect'
import type { PolkadotSigner, TxEvent } from 'polkadot-api'
import type { Observable } from 'rxjs'
import { finalizedTransactionFromTx } from './finalized-transaction.acl.js'
import type { FinalizedTransaction } from './finalized-transaction.schema.js'
import { ChainId, SubmissionKey } from './submission-key.schema.js'
import { makeSubmissionSerializer } from './submission-serializer.policy.js'

export { ChainId }

const submissionKeyOf = S.decodeSync(SubmissionKey)

export namespace ChainSubmitter {
  export interface SubmittableTx {
    readonly signSubmitAndWatch: (from: PolkadotSigner) => Observable<TxEvent>
  }

  export interface SubmitOptions {
    readonly chain: ChainId
    readonly timeout: Duration.Duration
    readonly finalizationTimeout: Duration.Duration
  }

  export interface Adapter {
    readonly submit: (
      signer: PolkadotSigner,
      tx: SubmittableTx,
      options: SubmitOptions,
    ) => Effect.Effect<
      FinalizedTransaction,
      TransactionSubmitError | TxBestBlockNotIncludedError | TxFinalizationError | TxInclusionTimeoutError
    >
  }
}

const make = Effect.gen(function*() {
  const serializer = yield* makeSubmissionSerializer

  const submitAndAwaitFinalized = (
    signer: PolkadotSigner,
    tx: ChainSubmitter.SubmittableTx,
    inclusionTimeout: Duration.Duration,
    finalizationTimeout: Duration.Duration,
  ): Effect.Effect<
    FinalizedTransaction,
    TransactionSubmitError | TxBestBlockNotIncludedError | TxFinalizationError | TxInclusionTimeoutError
  > =>
    Effect.sync(() => tx.signSubmitAndWatch(signer)).pipe(
      Effect.map(fromObservable((cause) => new TransactionSubmitError({ cause }))),
      Effect.andThen((events) =>
        events.pipe(
          Stream.tap(logTxEvent),
          watchThroughReorgs,
          runTxFinalized({
            inclusionTimeout,
            finalizationTimeout,
          }),
        )
      ),
      Effect.map(finalizedTransactionFromTx),
    )

  const submit: ChainSubmitter.Adapter['submit'] = (signer, tx, { chain, timeout, finalizationTimeout }) =>
    serializer.serialize(
      submissionKeyOf({ chain, account: toHex(signer.publicKey) }),
      Effect.scoped(submitAndAwaitFinalized(signer, tx, timeout, finalizationTimeout)),
    ).pipe(Effect.withSpan('blockchain.submit_and_finalize'))

  return ChainSubmitter.of({ submit })
})

export class ChainSubmitter extends Context.Tag('@app/ChainSubmitter')<
  ChainSubmitter,
  ChainSubmitter.Adapter
>() {
  static readonly Default = Layer.effect(ChainSubmitter, make)
}
