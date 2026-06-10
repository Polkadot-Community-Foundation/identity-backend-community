import { PeopleTypedAPI } from '#root/infrastructure/adapters/blockchain/people-typed-api.service.js'
import type { sr25519 } from '@identity-backend/crypto'
import { Ss58String } from '@identity-backend/substrate-schema'
import { ss58Address } from '@polkadot-labs/hdkd-helpers'
import { Duration, Effect, pipe, Schedule, Schema as S } from 'effect'
import { type Transaction, type TxCallData } from 'polkadot-api'

export type ItemFailedEvFilter = Effect.Effect.Success<
  typeof PeopleTypedAPI
>['event']['Utility']['ItemFailed']['filter']

export class UtilityAPIError extends S.TaggedError<UtilityAPIError>()(
  'UtilityAPIError',
  {
    cause: S.Unknown,
  },
) {}

export namespace UtilityAPI {
  export interface UtilityAPI {
    forceBatch: (params: {
      calls: TxCallData[]
      // oxlint-disable-next-line typescript/no-explicit-any
    }) => Effect.Effect<Transaction<any, any>, never, never>
    getLatestFinalizedBlock: () => Effect.Effect<
      number,
      UtilityAPIError,
      never
    >
    computeSs58Address: (
      publicKey: sr25519.PublicKey,
    ) => Effect.Effect<Ss58String, never, never>
    getSs58Prefix: () => Effect.Effect<number, never, never>
    filterUtilityItemFailed: Effect.Effect<ItemFailedEvFilter, never, never>
  }
}

export class UtilityAPI extends Effect.Service<UtilityAPI>()(
  '@app/UtilityAPI',
  {
    effect: Effect.gen(function*() {
      const nextAPI = yield* PeopleTypedAPI

      const filterUtilityItemFailed = Effect.sync(() => {
        const nextAPICall = nextAPI.event.Utility.ItemFailed
        return nextAPICall.filter
      })

      const forceBatch = (params: { calls: TxCallData[] }) =>
        Effect.sync(() => {
          const nextAPICall = nextAPI.tx.Utility.force_batch
          return nextAPICall({ calls: params.calls })
        }).pipe(
          Effect.withLogSpan('utility_api/forceBatch'),
          Effect.withSpan('utility_api/forceBatch'),
        )

      const getLatestFinalizedBlock = (() =>
        Effect.gen(function*() {
          const nextAPICall = nextAPI.query.System.Number
          return yield* Effect.tryPromise(() => nextAPICall.getValue())
        }).pipe(
          // Set timeout to 6000ms.
          // Determined by running the query 100 times concurrently (limit 10) against various endpoints.
          // The highest observed 99th percentile (P99) duration was ~5400ms.
          // 6000ms provides a buffer over the observed P99 for network fluctuations.
          Effect.timeout(Duration.seconds(6)),
          Effect.retry(
            Schedule.intersect(
              Schedule.exponential('100 millis'),
              Schedule.recurs(2),
            ),
          ),
          Effect.mapError((err) => new UtilityAPIError({ cause: err })),
          Effect.withLogSpan('utility_api/get_latest_finalized_block'),
          Effect.withSpan('utility_api/get_latest_finalized_block'),
        )) satisfies UtilityAPI.UtilityAPI['getLatestFinalizedBlock']

      const getSs58Prefix = (() =>
        Effect.gen(function*() {
          const nextAPICall = nextAPI.constants.System.SS58Prefix
          return yield* Effect.promise(() => nextAPICall())
        }).pipe(
          Effect.withLogSpan('utility_api/get_ss58_prefix'),
          Effect.withSpan('utility_api/get_ss58_prefix'),
        )) satisfies UtilityAPI.UtilityAPI['getSs58Prefix']

      const computeSs58Address = ((publicKey) =>
        pipe(
          getSs58Prefix(),
          Effect.andThen((prefix) => ss58Address(publicKey, prefix)),
          Effect.andThen(S.decode(Ss58String)),
          Effect.orDie,
          Effect.withLogSpan('utility_api/compute_ss58Address'),
          Effect.withSpan('utility_api/compute_ss58Address'),
        )) satisfies UtilityAPI.UtilityAPI['computeSs58Address'] as UtilityAPI.UtilityAPI['computeSs58Address']

      return {
        forceBatch,
        computeSs58Address,
        filterUtilityItemFailed,
        getLatestFinalizedBlock,
        getSs58Prefix,
      } satisfies UtilityAPI.UtilityAPI as UtilityAPI.UtilityAPI
    }),
  },
) {}
