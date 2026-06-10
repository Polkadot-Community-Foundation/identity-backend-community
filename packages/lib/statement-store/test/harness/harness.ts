import { pairwiseFor } from '@identity-backend/effect-vitest-gherkin'
import { Effect, Layer } from 'effect'
import { getWsProvider } from 'polkadot-api/ws'
import { StatementStoreFake } from '../../src/fake.js'
import { StatementStoreConfig, StatementStoreService } from '../../src/index.js'
import { StatementStoreLive } from '../../src/live.js'
import { PpnRuntime } from '../runtime/ppn-runtime.js'

export type StatementStoreHarness =
  | { readonly kind: 'fake-only'; readonly scenarioLayer: Layer.Layer<StatementStoreService> }
  | { readonly kind: 'pairwise'; readonly pairwiseStores: ReturnType<typeof pairwiseFor> }

export const makeFakeHarness = (): StatementStoreHarness => ({
  kind: 'fake-only',
  scenarioLayer: StatementStoreFake,
})

export const makePairwiseHarness = (): StatementStoreHarness => ({
  kind: 'pairwise',
  pairwiseStores: pairwiseFor(
    {
      a: { name: 'Fake', layer: StatementStoreFake },
      b: {
        name: 'Live',
        layer: Layer.unwrapEffect(
          Effect.gen(function*() {
            const rt = yield* PpnRuntime
            return Layer.provideMerge(
              StatementStoreLive,
              Layer.succeed(StatementStoreConfig, { provider: getWsProvider(rt.wsUrl) }),
            )
          }),
        ),
      },
    },
    StatementStoreService,
  ),
})
