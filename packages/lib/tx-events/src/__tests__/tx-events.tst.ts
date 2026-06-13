import type { Duration } from 'effect'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'
import type { TxEvent, TxFinalized } from 'polkadot-api'
import { describe, expect, test } from 'tstyche'

import { runTxFinalized, TxFinalizationError, TxInclusionTimeoutError } from '../tx-events.js'

declare const effectFreeStream: Stream.Stream<TxEvent, never, never>
declare const effectfulStream: Stream.Stream<TxEvent, 'Boom', 'Service'>
declare const options: { inclusionTimeout: Duration.Duration; finalizationTimeout: Duration.Duration }

describe('runTxFinalized speaks the polkadot-api tx types', () => {
  test('Should_ConsumeTxEventStreamAndYieldPolkadotApiTxFinalized_When_StreamIsEffectFree', () => {
    expect(runTxFinalized(effectFreeStream, options))
      .type.toBe<Effect.Effect<TxFinalized, TxInclusionTimeoutError | TxFinalizationError, never>>()
  })

  test('Should_ThreadStreamErrorAndRequirementChannels_When_StreamHasEffects', () => {
    expect(runTxFinalized(effectfulStream, options))
      .type.toBe<Effect.Effect<TxFinalized, TxInclusionTimeoutError | TxFinalizationError | 'Boom', 'Service'>>()
  })
})
