import { timeoutFirstFail } from '#root/utils/streams.js'
import { Duration, Effect, Function, Match, Option, pipe, Schema as S, Sink, Stream } from 'effect'
import type { TxEvent, TxFinalized } from 'polkadot-api'

export const SpanAttributes = Object.freeze(
  {
    BLOCKCHAIN_TX_HASH: 'blockchain.tx.hash',
    BLOCKCHAIN_TX_FINALIZED: 'blockchain.tx.finalized',
    BLOCKCHAIN_TX_BLOCK_NUMBER: 'blockchain.tx.block_number',
    BLOCKCHAIN_TX_BLOCK_HASH: 'blockchain.tx.block_hash',
  } as const,
)

export class TxBestBlockNotIncludedError
  extends S.TaggedError<TxBestBlockNotIncludedError>()('TxBestBlockNotIncludedError', {
    txHash: S.String,
    isValid: S.Boolean,
  })
{}

export class TxFinalizationError extends S.TaggedError<TxFinalizationError>()('TxFinalizationError', {
  cause: S.Unknown,
}) {
  override get message() {
    return 'No finalized event received'
  }
}

export const logTxEvent = (event: TxEvent): Effect.Effect<void> =>
  pipe(
    Match.value(event),
    Match.discriminator('type')('signed', (ev) =>
      Effect.logDebug('Transaction signed').pipe(
        Effect.annotateLogs({ 'tx.event': ev.type, 'tx.hash': ev.txHash }),
      )),
    Match.discriminator('type')('broadcasted', (ev) =>
      Effect.logDebug('Transaction broadcasted').pipe(
        Effect.annotateLogs({ 'tx.event': ev.type, 'tx.hash': ev.txHash }),
      )),
    Match.discriminator('type')('txBestBlocksState', (ev) =>
      Match.value(ev).pipe(
        Match.when({ found: true }, (ev) =>
          Effect.logDebug('Transaction entered best blocks state').pipe(
            Effect.annotateLogs({
              'tx.event': ev.type,
              'tx.hash': ev.txHash,
              'tx.ok': ev.ok,
              'tx.block.index': ev.block.index,
              'tx.block.number': ev.block.number,
              'tx.block.hash': ev.block.hash,
              'tx.event_count': ev.events.length,
              'tx.dispatch_error': !!ev.dispatchError,
            }),
          )),
        Match.when({ found: false }, (ev) =>
          Effect.logWarning('Transaction not found in best block state').pipe(
            Effect.annotateLogs({
              'tx.event': ev.type,
              'tx.hash': ev.txHash,
              'tx.is_valid': ev.isValid,
            }),
          )),
        Match.exhaustive,
      )),
    Match.discriminator('type')('finalized', (ev) =>
      Effect.logDebug('Transaction finalized').pipe(
        Effect.annotateLogs({
          'tx.event': ev.type,
          'tx.hash': ev.txHash,
          'tx.ok': ev.ok,
          'tx.block.index': ev.block.index,
          'tx.block.number': ev.block.number,
          'tx.block.hash': ev.block.hash,
          'tx.event_count': ev.events.length,
          'tx.dispatch_error': !!ev.dispatchError,
        }),
      )),
    Match.exhaustive,
  )

export const watchThroughReorgs = <E, R>(
  stream: Stream.Stream<TxEvent, E, R>,
): Stream.Stream<TxEvent, TxBestBlockNotIncludedError | E, R> =>
  pipe(
    stream,
    Stream.tap((event) =>
      Match.value(event).pipe(
        Match.when(
          { type: 'txBestBlocksState', found: false, isValid: false },
          (e) =>
            Effect.fail(
              new TxBestBlockNotIncludedError({
                txHash: e.txHash,
                isValid: e.isValid,
              }),
            ),
        ),
        Match.when(
          { type: 'txBestBlocksState', found: false, isValid: true },
          (e) =>
            Effect.logWarning(
              'Transaction temporarily out of best blocks (reorg), continuing to watch',
            ).pipe(Effect.annotateLogs({ 'tx.hash': e.txHash })),
        ),
        Match.orElse(() => Effect.void),
      )
    ),
  )

interface RunTxFinalizedOptions {
  readonly timeout: Duration.Duration
}

export const runTxFinalized = Function.dual<
  (
    options: RunTxFinalizedOptions,
  ) => <E, R>(
    self: Stream.Stream<TxEvent, E, R>,
  ) => Effect.Effect<TxFinalized, TxFinalizationError | E, R>,
  <E, R>(
    self: Stream.Stream<TxEvent, E, R>,
    options: RunTxFinalizedOptions,
  ) => Effect.Effect<TxFinalized, TxFinalizationError | E, R>
>(2, (self, { timeout }) =>
  pipe(
    self,
    timeoutFirstFail(
      () =>
        new TxFinalizationError({
          cause: new Error(`Timeout after ${Duration.toMillis(timeout)}ms`),
        }),
      timeout,
    ),
    Stream.filter((e): e is TxFinalized => e.type === 'finalized'),
    Stream.run(Sink.head()),
    Effect.flatMap((option) =>
      Option.match(option, {
        onNone: () =>
          Effect.fail(
            new TxFinalizationError({
              cause: new Error('No finalized event received'),
            }),
          ),
        onSome: Effect.succeed,
      })
    ),
    Effect.tap((result) =>
      Effect.annotateCurrentSpan({
        [SpanAttributes.BLOCKCHAIN_TX_HASH]: result.txHash,
        [SpanAttributes.BLOCKCHAIN_TX_BLOCK_HASH]: result.block.hash,
      })
    ),
  ))
