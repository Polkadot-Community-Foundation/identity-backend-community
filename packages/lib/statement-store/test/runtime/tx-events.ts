import { Duration, Effect, Function, Match, Option, pipe, Schema as S, Sink, Stream } from 'effect'
import type { LazyArg } from 'effect/Function'
import type { TxEvent, TxFinalized } from 'polkadot-api'

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
      Effect.logInfo('tx signed').pipe(Effect.annotateLogs({ 'tx.event': ev.type, 'tx.hash': ev.txHash }))),
    Match.discriminator('type')('broadcasted', (ev) =>
      Effect.logInfo('tx broadcasted').pipe(Effect.annotateLogs({ 'tx.event': ev.type, 'tx.hash': ev.txHash }))),
    Match.discriminator('type')('txBestBlocksState', (ev) =>
      Match.value(ev).pipe(
        Match.when({ found: true }, (ev) =>
          Effect.logInfo('tx in best block').pipe(Effect.annotateLogs({
            'tx.event': ev.type,
            'tx.hash': ev.txHash,
            'tx.ok': ev.ok,
            'tx.block.number': ev.block.number,
            'tx.dispatch_error': !!ev.dispatchError,
          }))),
        Match.when({ found: false }, (ev) =>
          Effect.logWarning('tx not in best block').pipe(Effect.annotateLogs({
            'tx.event': ev.type,
            'tx.hash': ev.txHash,
            'tx.is_valid': ev.isValid,
          }))),
        Match.exhaustive,
      )),
    Match.discriminator('type')('finalized', (ev) =>
      Effect.logInfo('tx finalized').pipe(Effect.annotateLogs({
        'tx.event': ev.type,
        'tx.hash': ev.txHash,
        'tx.ok': ev.ok,
        'tx.block.number': ev.block.number,
        'tx.dispatch_error': !!ev.dispatchError,
      }))),
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
          (e) => Effect.fail(new TxBestBlockNotIncludedError({ txHash: e.txHash, isValid: e.isValid })),
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

const timeoutFirstFail =
  <E2>(error: LazyArg<E2>, duration: Duration.DurationInput) => <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    pipe(
      stream,
      Stream.broadcast(2, { capacity: 'unbounded' }),
      Stream.flatMap(([first, second]) =>
        Stream.merge(
          first.pipe(Stream.timeoutFail(error, duration), Stream.take(1), Stream.flatMap(() => Stream.empty)),
          second,
          { haltStrategy: 'right' },
        )
      ),
    )

interface RunTxFinalizedOptions {
  readonly timeout: Duration.Duration
}

export const runTxFinalized = Function.dual<
  (options: RunTxFinalizedOptions) => <E, R>(
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
      () => new TxFinalizationError({ cause: new Error(`Timeout after ${Duration.toMillis(timeout)}ms`) }),
      timeout,
    ),
    Stream.filter((e): e is TxFinalized => e.type === 'finalized'),
    Stream.run(Sink.head()),
    Effect.flatMap((option) =>
      Option.match(option, {
        onNone: () => Effect.fail(new TxFinalizationError({ cause: new Error('No finalized event received') })),
        onSome: Effect.succeed,
      })
    ),
  ))
