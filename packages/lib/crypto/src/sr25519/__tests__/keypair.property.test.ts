import { describe, it } from '@effect/vitest'
import { Context, Effect, Either, Layer, Schema } from 'effect'
import { generateKeypair, type Keypair } from '../keypair.js'

class KeypairCtx extends Context.Tag('KeypairCtx')<KeypairCtx, Keypair>() {}

const layer = Layer.effect(KeypairCtx, generateKeypair())

describe('sr25519', () => {
  it.layer(layer)((it) => {
    it.effect.prop(
      '∀m_VerifyArbitrary_∈Result',
      [Schema.Uint8Array, Schema.Uint8Array],
      ([message, signature]) =>
        Effect.gen(function*() {
          const keypair = yield* KeypairCtx
          const result = yield* Effect.either(keypair.verify(message, signature))
          return Either.isRight(result)
        }),
    )

    it.effect.prop(
      '∀m_SignVerify_≡m',
      [Schema.Uint8Array],
      ([message]) =>
        Effect.gen(function*() {
          const keypair = yield* KeypairCtx
          const signature = yield* keypair.sign(message)
          return yield* keypair.verify(message, signature)
        }),
    )
  })
})
