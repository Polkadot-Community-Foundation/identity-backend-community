import { BaseUsername, UsernameDigits } from '#root/schema/username.js'
import { describe, it } from '@effect/vitest'
import { Effect, Layer, Random, Schema as S } from 'effect'
import { selectDigits } from '../digit-selection.js'

describe('Digit Selection', () => {
  const AvailableDigitsSchema = S.Array(UsernameDigits).pipe(
    S.minItems(1),
    S.maxItems(100),
  )

  const AvailableDigitsWithNon00Schema = AvailableDigitsSchema

  const AvailableDigitsWith00AndOthersSchema = S.Array(UsernameDigits).pipe(
    S.minItems(3),
    S.maxItems(100),
  )

  const SeedSchema = S.Int

  it.effect.prop(
    '∃x_ReturnAvailableDigit_∈x',
    [AvailableDigitsWithNon00Schema, BaseUsername, SeedSchema],
    ([availableDigits, baseUsername, seed]) =>
      Effect.gen(function*() {
        const availableNon00 = availableDigits.filter((d) => d !== '00')
        if (availableNon00.length === 0) {
          return true
        }

        const result = yield* selectDigits({ availableDigits, baseUsername })
        return availableNon00.includes(result)
      }).pipe(Effect.provide(Layer.succeed(Random.Random, Random.make(seed)))),
  )

  it.effect.prop(
    '∀x_NeverReturn00_≠x',
    [AvailableDigitsWith00AndOthersSchema, BaseUsername, SeedSchema],
    ([availableDigits, baseUsername, seed]) =>
      Effect.gen(function*() {
        if (!availableDigits.includes(UsernameDigits.make('00'))) {
          return true
        }

        const result = yield* selectDigits({ availableDigits, baseUsername })
        return result !== '00'
      }).pipe(Effect.provide(Layer.succeed(Random.Random, Random.make(seed)))),
  )

  it.effect.prop(
    '∀x_BeDeterministic_=x',
    [AvailableDigitsSchema, UsernameDigits, BaseUsername, SeedSchema],
    ([availableDigits, preferredDigits, baseUsername, seed]) =>
      Effect.gen(function*() {
        if (!availableDigits.includes(preferredDigits)) {
          return true
        }

        const result1 = yield* selectDigits({ availableDigits, preferredDigits, baseUsername })
        const result2 = yield* selectDigits({ availableDigits, preferredDigits, baseUsername })

        return result1 === result2
      }).pipe(Effect.provide(Layer.succeed(Random.Random, Random.make(seed)))),
  )
})
