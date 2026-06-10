import { DefectReporter } from '#root/infrastructure/observability/mod.js'
import { withSupervision } from '#root/lib/daemon-spec.js'
import { PolkadotClient } from '@identity-backend/json-rpc'
import { Cause, Context, Duration, Effect, Layer, pipe, Runtime, Schedule, Schema as S } from 'effect'

export const BlockTimeout = pipe(
  S.Number.pipe(S.int(), S.nonNegative()),
  S.brand('@identity-backend/block-finalization/BlockTimeout'),
)

export type BlockTimeout = S.Schema.Type<typeof BlockTimeout>

const Options = S.Struct({
  blockTimeout: BlockTimeout,
})

type Options = S.Schema.Type<typeof Options>

class BlockChainStuckError extends S.TaggedError<BlockChainStuckError>()(
  'BlockChainStuckError',
  {
    blockNumber: S.Number,
  },
) {}

export class BlockFinalizationDaemonConfig extends Context.Reference<BlockFinalizationDaemonConfig>()(
  'BlockFinalizationDaemonConfig',
  {
    defaultValue: () => ({
      supervisorMaxRestarts: 5,
      supervisorBackoffBaseDelay: Duration.seconds(10),
      supervisorBackoffMaxDelay: Duration.minutes(5),
      supervisorCooldown: Duration.minutes(30),
    }),
  },
) {}

export const layerBlockFinalizationDaemon = (client: PolkadotClient.PolkadotClientWithProvider, options: Options) =>
  Layer.effectDiscard(
    Effect.gen(function*() {
      const config = yield* BlockFinalizationDaemonConfig
      const reporter = yield* DefectReporter
      const reportCause = (cause: Cause.Cause<unknown>) => reporter.captureException(cause)
      const { distinctUntilChanged, map, tap, throwError, timeout } = yield* Effect.promise(() => import('rxjs'))
      const { blockTimeout } = options
      const runtime = yield* Effect.runtime()

      const { name: chainName } = yield* Effect.promise(() => client.getChainSpecData())

      const loop = Effect.acquireRelease(
        Effect.sync(() => {
          let lastKnownBlockNumber = -1

          return client.finalizedBlock$
            .pipe(
              map((info) => info.number),
              tap((blockNumber) => {
                lastKnownBlockNumber = blockNumber
              }),
              distinctUntilChanged(),
              timeout({
                each: blockTimeout,
                with: () =>
                  throwError(
                    () =>
                      new BlockChainStuckError({
                        blockNumber: lastKnownBlockNumber,
                      }),
                  ),
              }),
            )
            .subscribe({
              error: (error) => {
                if (error instanceof BlockChainStuckError) {
                  Effect.gen(function*() {
                    yield* Effect.void.pipe(
                      Effect.tap(() =>
                        Effect.annotateLogsScoped({
                          chainName,
                          blockNumber: error.blockNumber,
                        })
                      ),
                      Effect.tap(() => Effect.logWarning(`Blockchain is stuck at block #${error.blockNumber}`)),
                      Effect.scoped,
                    )

                    yield* Effect.sync(() => client.reconnect())
                  }).pipe(Runtime.runSync(runtime))
                }
              },
            })
        }),
        (subscription) => Effect.sync(() => subscription.unsubscribe()),
      ).pipe(Effect.scoped)

      yield* loop.pipe(
        withSupervision({
          name: 'block-finalization',
          maxRestarts: config.supervisorMaxRestarts,
          backoff: Schedule.exponential(config.supervisorBackoffBaseDelay).pipe(
            Schedule.jittered,
            Schedule.upTo(config.supervisorBackoffMaxDelay),
          ),
          cooldown: config.supervisorCooldown,
          onRestart: reportCause,
          onExhausted: reportCause,
        }),
        Effect.fork,
      )
    }),
  )

export const layerBlockFinalizationDaemonWith =
  (options: Options) => (client: PolkadotClient.PolkadotClientWithProvider) =>
    layerBlockFinalizationDaemon(client, options)

export { Options as LayerMonitorStuckFinalizedBlocksOptions }
