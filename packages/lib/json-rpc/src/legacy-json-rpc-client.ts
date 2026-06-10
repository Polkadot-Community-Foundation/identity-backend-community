import { PrefixedHex } from '@identity-backend/substrate-schema'
import { Effect, pipe, Schema as S } from 'effect'
import type { PolkadotClientWithProvider } from './polkadot-client'

export class LegacyJSONRPCError extends S.TaggedError<LegacyJSONRPCError>()(
  'LegacyJSONRPCError',
  { cause: S.Unknown },
) {}

export const BlockDelta = S.Struct({
  block: PrefixedHex,
  changes: S.Array(S.Tuple(PrefixedHex, S.NullOr(PrefixedHex))),
})

export const ChainProperties = S.Struct({
  ss58Format: S.NonNegativeInt,
  tokenDecimals: S.NonNegativeInt,
  tokenSymbol: S.String,
})

export type BlockDelta = S.Schema.Type<typeof BlockDelta>

export type ChainProperties = S.Schema.Type<typeof ChainProperties>

export interface Definition {
  readonly getFinalizedHead: () => Effect.Effect<PrefixedHex, LegacyJSONRPCError>
  readonly getSystemProperties: () => Effect.Effect<ChainProperties, LegacyJSONRPCError>
  readonly queryStorageAt: (
    keys: ReadonlyArray<PrefixedHex>,
    options: { atBlockHash: PrefixedHex },
  ) => Effect.Effect<ReadonlyArray<BlockDelta>, LegacyJSONRPCError>
  readonly getKeysPaged: (
    prefix: PrefixedHex,
    options: { pageSize: number; startKey?: PrefixedHex; atBlockHash: PrefixedHex },
  ) => Effect.Effect<ReadonlyArray<PrefixedHex>, LegacyJSONRPCError>
}

export const make = (client: PolkadotClientWithProvider): Definition => {
  const sendUnknown = (method: string, params: readonly unknown[]) =>
    Effect.gen(function*() {
      yield* Effect.annotateCurrentSpan({
        attributes: {
          'rpc.system': 'substrate',
          'ledger.network': client.network,
          'ledger.chain': client.chain,
        },
      })

      return yield* Effect.tryPromise({
        try: () => client._request<unknown>(method, [...params]),
        catch: (cause) => new LegacyJSONRPCError({ cause }),
      })
    })

  return {
    getFinalizedHead: Effect.fn('blockchain.chain_get_finalized_head')(
      function*() {
        yield* Effect.annotateCurrentSpan({
          attributes: {
            'rpc.method': 'chain_getFinalizedHead',
          },
        })

        return yield* sendUnknown('chain_getFinalizedHead', []).pipe(
          Effect.flatMap((s) => S.decodeUnknown(PrefixedHex)(s).pipe(Effect.orDie)),
        )
      },
    ),
    getSystemProperties: Effect.fn('blockchain.system_properties')(
      function*() {
        yield* Effect.annotateCurrentSpan({
          attributes: {
            'rpc.method': 'system_properties',
          },
        })

        return yield* sendUnknown('system_properties', []).pipe(
          Effect.flatMap((raw) => S.decodeUnknown(ChainProperties)(raw).pipe(Effect.orDie)),
        )
      },
    ),
    queryStorageAt: Effect.fn('blockchain.state_query_storage_at')(
      function*(keys, { atBlockHash }) {
        yield* Effect.annotateCurrentSpan({
          attributes: {
            'rpc.method': 'state_queryStorageAt',
            'ledger.block.hash': atBlockHash,
            'substrate.rpc.key_count': keys.length,
          },
        })

        return yield* pipe(
          sendUnknown('state_queryStorageAt', [keys, atBlockHash]),
          Effect.flatMap((raw) => S.decodeUnknown(S.Array(BlockDelta))(raw).pipe(Effect.orDie)),
        )
      },
    ),
    getKeysPaged: Effect.fn('blockchain.state_getKeysPaged')(function*(prefix, options) {
      yield* Effect.annotateCurrentSpan({
        attributes: {
          'rpc.method': 'state_getKeysPaged',
          'ledger.block.hash': options.atBlockHash,
          'substrate.rpc.storage_page_size': options.pageSize,
        },
      })

      return yield* pipe(
        sendUnknown('state_getKeysPaged', [
          prefix,
          options.pageSize,
          options.startKey ?? null,
          options.atBlockHash,
        ]),
        Effect.flatMap((raw) => S.decodeUnknown(S.Array(PrefixedHex))(raw).pipe(Effect.orDie)),
      )
    }),
  }
}
