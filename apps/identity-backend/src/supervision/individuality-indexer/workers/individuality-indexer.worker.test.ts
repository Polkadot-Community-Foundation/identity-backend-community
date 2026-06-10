import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect } from 'vitest'
import { IndividualityIndexerRuntimeConfig } from './individuality-indexer.worker.js'

describe('IndividualityIndexerRuntimeConfig', () => {
  it.effect('Should_StayWithinStateGetKeysPagedCap_When_UsingDefaultStoragePageSize', (ctx) =>
    Effect.gen(function*() {
      yield* Effect.promise(() =>
        ctx.annotate(
          'Substrate node caps state_getKeysPaged count at STORAGE_KEYS_PAGED_MAX_COUNT = 1000. ' +
            'Going above this triggers RpcError "count exceeds maximum value" and kills the indexer fiber. ' +
            'Upstream definition: https://github.com/paritytech/polkadot-sdk/blob/94f200baf9d331175b678cc090a7eb92bb41802c/substrate/client/rpc/src/state/mod.rs#L46',
          'reference',
        )
      )

      const config = yield* IndividualityIndexerRuntimeConfig

      expect(config.storagePageSize).toBe(1000)
      expect(config.storagePageSize).toBeLessThanOrEqual(1000)
    }))
})
