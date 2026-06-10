import { PlanckBalance } from '#root/schema/balance.js'
import { LegacyJSONRPCClient, PolkadotClient } from '@identity-backend/json-rpc'
import { PrefixedHex } from '@identity-backend/substrate-schema'
import { Effect, HashMap, Option, Schema as S } from 'effect'

export interface Codec {
  readonly encodeKey: (accountId: string) => string
  readonly decodeValue: (valueHex: string) => { readonly data: { readonly free: bigint } }
}

export const make = (input: {
  readonly client: PolkadotClient.PolkadotClientWithProvider
  readonly codec: Codec
}) => {
  const rpc = LegacyJSONRPCClient.make(input.client)

  const getFreeBalances = (
    accountIds: ReadonlyArray<string>,
  ): Effect.Effect<ReadonlyArray<PlanckBalance>, never> =>
    Effect.gen(function*() {
      if (accountIds.length === 0) return []

      const finalizedHash = yield* rpc.getFinalizedHead().pipe(Effect.orDie)
      const keys = yield* Effect.forEach(accountIds, (id) =>
        S.decode(PrefixedHex)(input.codec.encodeKey(id)).pipe(Effect.orDie))
      const changes = yield* rpc.queryStorageAt(keys, { atBlockHash: finalizedHash }).pipe(Effect.orDie)

      let changeMap = HashMap.empty<PrefixedHex, PrefixedHex | null>()
      for (const block of changes) {
        for (const [key, val] of block.changes) {
          changeMap = HashMap.set(changeMap, key, val)
        }
      }

      return yield* Effect.forEach(keys, (k) =>
        Effect.gen(function*() {
          const entry = HashMap.get(changeMap, k)
          if (Option.isNone(entry)) {
            return PlanckBalance.make(0n)
          }
          const val = entry.value
          if (val === null) {
            return PlanckBalance.make(0n)
          }
          const decoded = yield* Effect.try(() =>
            input.codec.decodeValue(val)
          ).pipe(Effect.orDie)
          return PlanckBalance.make(decoded.data.free)
        }))
    })

  return { getFreeBalances }
}
