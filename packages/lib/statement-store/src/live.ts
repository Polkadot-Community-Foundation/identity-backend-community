import type { RequestFn, Statement as SdkStatement, SubscribeFn } from '@novasamatech/sdk-statement'
import type { SubstrateClient } from '@polkadot-api/substrate-client'
import { Chunk, Effect, Layer, Schema as S, Stream } from 'effect'
import { StatementStoreConfig, StatementStoreError, StatementStoreService } from './index.js'
import { verifyStream } from './process-statement.js'
import { StatementSubmitRpcSchema } from './submit-result-rpc.js'

export {
  StatementHash,
  StatementStoreConfig,
  StatementStoreError,
  StatementStoreService,
  VerifiedStatement,
} from './index.js'
export { processStatement, verifyStream } from './process-statement.js'

const toRequestFn = (client: SubstrateClient): RequestFn => (method, params) => client.request(method, params)

const toSubscribeFn =
  (client: SubstrateClient): SubscribeFn =>
  <T>(method: string, params: unknown[], onMessage: (message: T) => void, onError: (error: Error) => void) => {
    let subscriptionId: string | null = null
    let innerUnsub: (() => void) | null = null
    const outerUnsub = client._request<string, T>(method, params, {
      onSuccess: (subId, followSubscription) => {
        subscriptionId = subId
        innerUnsub = followSubscription(subscriptionId, {
          next: (data) => onMessage(data),
          error: onError,
        })
      },
      onError,
    })
    return () => {
      if (subscriptionId !== null) {
        client.request(`statement_unsubscribeStatement`, [subscriptionId]).catch(() => {})
      }
      innerUnsub?.()
      outerUnsub()
    }
  }

const make = Effect.gen(function*() {
  const { createStatementSdk } = yield* Effect.promise(() => import('@novasamatech/sdk-statement'))
  const { createClient } = yield* Effect.promise(() => import('@polkadot-api/substrate-client'))

  const { provider } = yield* StatementStoreConfig
  const client = createClient(provider)
  yield* Effect.addFinalizer(() => Effect.sync(() => client.destroy()))

  const sdk = createStatementSdk(toRequestFn(client), toSubscribeFn(client))

  const submit: StatementStoreService.Definition['submit'] = (stmt) =>
    Effect.tryPromise(() => sdk.submit(stmt)).pipe(
      Effect.andThen((raw) => S.decodeUnknown(StatementSubmitRpcSchema)(raw)),
      Effect.mapError((cause) => new StatementStoreError({ reason: 'submit_failed', cause })),
    )

  const subscribeStatements: StatementStoreService.Definition['subscribeStatements'] = (filter = 'any') =>
    Stream.asyncPush<SdkStatement, StatementStoreError>((emit) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          sdk.subscribeStatements(filter, (s) =>
            emit.single(s), (err) =>
            emit.fail(new StatementStoreError({ reason: 'subscribe_failed', cause: err })))
        ),
        (unsubscribe) =>
          Effect.sync(unsubscribe),
      )
    ).pipe(verifyStream())

  const getStatements: StatementStoreService.Definition['getStatements'] = (filter = 'any') =>
    Effect.tryPromise({
      try: () => sdk.getStatements(filter),
      catch: (cause) => new StatementStoreError({ reason: 'get_failed', cause }),
    }).pipe(
      Effect.flatMap((stmts) =>
        Stream.fromIterable(stmts).pipe(
          verifyStream(),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
        )
      ),
    )

  return StatementStoreService.of({ submit, subscribeStatements, getStatements })
})

export const StatementStoreLive: Layer.Layer<StatementStoreService, never, StatementStoreConfig> = Layer.scoped(
  StatementStoreService,
  make,
)
