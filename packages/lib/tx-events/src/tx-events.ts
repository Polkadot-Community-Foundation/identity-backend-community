import {
  LedgerAttributes,
  LINK_RELATIONSHIP_ATTRIBUTE,
  LinkRelationship,
  spanLink,
} from '@identity-backend/observability'
import { Duration, Effect, Function, Match, Option, pipe, Schema as S, Stream } from 'effect'
import type { TxEvent, TxFinalized } from 'polkadot-api'

const LEDGER_SYSTEM = 'substrate' as const

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

export class TxInclusionTimeoutError extends S.TaggedError<TxInclusionTimeoutError>()('TxInclusionTimeoutError', {
  cause: S.Unknown,
}) {
  override get message() {
    return 'Transaction was not included in a block before the inclusion deadline'
  }
}

type TxBestBlocksFound = TxEvent & { readonly type: 'txBestBlocksState'; readonly found: true }

const isTxBestBlocksFound = (event: TxEvent): event is TxBestBlocksFound =>
  event.type === 'txBestBlocksState' && event.found === true

const isTxFinalized = (event: TxEvent): event is TxFinalized => event.type === 'finalized'

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
  readonly inclusionTimeout: Duration.Duration
  readonly finalizationTimeout: Duration.Duration
}

export const runTxFinalized = Function.dual<
  (
    options: RunTxFinalizedOptions,
  ) => <E, R>(
    self: Stream.Stream<TxEvent, E, R>,
  ) => Effect.Effect<TxFinalized, TxInclusionTimeoutError | TxFinalizationError | E, R>,
  <E, R>(
    self: Stream.Stream<TxEvent, E, R>,
    options: RunTxFinalizedOptions,
  ) => Effect.Effect<TxFinalized, TxInclusionTimeoutError | TxFinalizationError | E, R>
>(2, (self, { inclusionTimeout, finalizationTimeout }) =>
  Effect.gen(function*() {
    const [inclusionStream, finalizationStream] = yield* Stream.broadcast(self, 2, { capacity: 'unbounded' })

    const inclusionSpan = yield* pipe(
      inclusionStream,
      Stream.filter(isTxBestBlocksFound),
      Stream.runHead,
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new TxInclusionTimeoutError({ cause: new Error('Stream ended before best-block inclusion') })),
          onSome: Effect.succeed,
        }),
      ),
      Effect.timeoutFail({
        onTimeout: () =>
          new TxInclusionTimeoutError({
            cause: new Error(`Tx not included in a block within ${Duration.toMillis(inclusionTimeout)}ms`),
          }),
        duration: inclusionTimeout,
      }),
      Effect.tap((event) =>
        Effect.annotateCurrentSpan({
          [LedgerAttributes.TX_HASH]: event.txHash,
          [LedgerAttributes.BLOCK_NUMBER]: event.block.number,
          [LedgerAttributes.BLOCK_HASH]: event.block.hash,
          [LedgerAttributes.TX_SUCCESS]: event.ok,
        })
      ),
      Effect.zipRight(Effect.currentSpan.pipe(Effect.orElse(() => Effect.succeed(null)))),
      Effect.withSpan('Tx.awaitInclusion', { attributes: { [LedgerAttributes.SYSTEM]: LEDGER_SYSTEM } }),
    )

    const inclusionLinks = Option.match(Option.fromNullable(inclusionSpan), {
      onNone: () => [],
      onSome: (span) => [spanLink(span, { [LINK_RELATIONSHIP_ATTRIBUTE]: LinkRelationship.INCLUDED_BY })],
    })

    const finalized = yield* pipe(
      finalizationStream,
      Stream.filter(isTxFinalized),
      Stream.runHead,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new TxFinalizationError({ cause: new Error('No finalized event received') })),
          onSome: Effect.succeed,
        }),
      ),
      Effect.timeoutFail({
        onTimeout: () =>
          new TxFinalizationError({
            cause: new Error(`Tx not finalized within ${Duration.toMillis(finalizationTimeout)}ms of inclusion`),
          }),
        duration: finalizationTimeout,
      }),
      Effect.tap((event) =>
        Effect.annotateCurrentSpan({
          [LedgerAttributes.TX_HASH]: event.txHash,
          [LedgerAttributes.BLOCK_NUMBER]: event.block.number,
          [LedgerAttributes.BLOCK_HASH]: event.block.hash,
          [LedgerAttributes.TX_SUCCESS]: event.ok,
        })
      ),
      Effect.withSpan('Tx.awaitFinalization', {
        attributes: { [LedgerAttributes.SYSTEM]: LEDGER_SYSTEM },
        links: inclusionLinks,
      }),
    )

    yield* Effect.annotateCurrentSpan({
      [LedgerAttributes.SYSTEM]: LEDGER_SYSTEM,
      [LedgerAttributes.TX_HASH]: finalized.txHash,
      [LedgerAttributes.BLOCK_HASH]: finalized.block.hash,
      [LedgerAttributes.TX_SUCCESS]: finalized.ok,
    })

    return finalized
  }).pipe(Effect.scoped))
