import { UsernameDigits } from '#root/schema/mod.js'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Random } from 'effect'
import { PreferredDigitsTakenError, selectDigits } from '../digit-selection.js'

const TestRandomLayer = Layer.succeed(Random.Random, Random.make(42))

it.layer(TestRandomLayer)('Digit Selection', it => {
  describe('@HappyPath', () => {
    it.effect('Should_ReturnPreferredDigits_When_AvailableInList', () =>
      Effect.gen(function*() {
        // --- @arrange: Available digits contains preferred choice ---
        const availableDigits = [UsernameDigits.make('00'), UsernameDigits.make('01'), UsernameDigits.make('42')]
        const preferredDigits = UsernameDigits.make('42')
        const baseUsername = 'alice'

        // --- @act: Select preferred digits ---
        const result = yield* selectDigits({ availableDigits, preferredDigits, baseUsername })

        // --- @assert: Returns preferred digits ---
        expect(result, 'Should return the preferred digits when available').toBe('42')
      }))

    it.effect('Should_ReturnRandomDigit_When_NoPreferenceSpecified', () =>
      Effect.gen(function*() {
        // --- @arrange: Available digits contain non-00 options, no preference ---
        const availableDigits = [UsernameDigits.make('00'), UsernameDigits.make('01'), UsernameDigits.make('99')]
        const baseUsername = 'alice'

        // --- @act: Select random digits ---
        const result = yield* selectDigits({ availableDigits, baseUsername })

        // --- @assert: Returns one of non-00 digits ---
        expect(['01', '99'].includes(result), 'Should return one of available digits excluding "00"').toBe(true)
      }))

    it.effect('Should_ReturnSingleAvailableDigit_When_OnlyOneNon00OptionExists', () =>
      Effect.gen(function*() {
        // --- @arrange: Only one non-00 digit available ---
        const availableDigits = [UsernameDigits.make('00'), UsernameDigits.make('42')]
        const baseUsername = 'alice'

        // --- @act: Select random digits ---
        const result = yield* selectDigits({ availableDigits, baseUsername })

        // --- @assert: Returns the only available digit ---
        expect(result, 'Should return the only available digit').toBe('42')
      }))
  })

  describe('@EdgeCase', () => {
    it.effect('Should_Exclude00_When_MultipleOptionsAvailable', () =>
      Effect.gen(function*() {
        // --- @arrange: Multiple digits available including 00 ---
        const availableDigits = [UsernameDigits.make('00'), UsernameDigits.make('01'), UsernameDigits.make('02')]
        const baseUsername = 'alice'

        // --- @act: Select random digits ---
        const result = yield* selectDigits({ availableDigits, baseUsername })

        // --- @assert: Returns non-00 digit ---
        expect(['01', '02'].includes(result), 'Should return either "01" or "02", never "00"').toBe(true)
      }))
  })

  describe('@ErrorCase', () => {
    it.effect('Should_ThrowPreferredDigitsTakenError_When_PreferredDigitsNotAvailable', () =>
      Effect.gen(function*() {
        // --- @arrange: Preferred digits not in available list ---
        const availableDigits = [UsernameDigits.make('00'), UsernameDigits.make('01'), UsernameDigits.make('02')]
        const preferredDigits = UsernameDigits.make('42')
        const baseUsername = 'alice'

        // --- @act: Attempt to select preferred digits ---
        const error = yield* selectDigits({ availableDigits, preferredDigits, baseUsername }).pipe(
          Effect.flip,
        )

        // --- @assert: Throws PreferredDigitsTakenError ---
        expect(error._tag, 'Should throw PreferredDigitsTakenError').toBe('PreferredDigitsTakenError')
      }))

    it.effect('Should_ThrowNoDigitsAvailableError_When_Only00Available', () =>
      Effect.gen(function*() {
        // --- @arrange: Only reserved 00 available, no preference ---
        const availableDigits = [UsernameDigits.make('00')]
        const baseUsername = 'alice'

        // --- @act: Attempt to select random digits ---
        const error = yield* selectDigits({ availableDigits, baseUsername }).pipe(
          Effect.flip,
        )

        // --- @assert: Throws NoDigitsAvailableError ---
        expect(error._tag, 'Should throw NoDigitsAvailableError').toBe('NoDigitsAvailableError')
      }))
  })

  it.effect('Should_ThrowNoDigitsAvailableError_When_EmptyList', () =>
    Effect.gen(function*() {
      // --- @arrange: No digits available at all ---
      const availableDigits: UsernameDigits[] = []
      const baseUsername = 'alice'

      // --- @act: Attempt to select random digits ---
      const error = yield* selectDigits({ availableDigits, baseUsername }).pipe(
        Effect.flip,
      )

      // --- @assert: Throws NoDigitsAvailableError ---
      expect(error._tag, 'Should throw NoDigitsAvailableError').toBe('NoDigitsAvailableError')
    }))

  describe('@EdgeCase', () => {
    it.effect('Should_AllowExplicit00Selection_When_ZeroZeroAvailable', () =>
      Effect.gen(function*() {
        // --- @arrange: User explicitly requests reserved 00 suffix ---
        const availableDigits = [UsernameDigits.make('00'), UsernameDigits.make('01')]
        const preferredDigits = UsernameDigits.make('00')
        const baseUsername = 'alice'

        // --- @act: Select preferred 00 digits ---
        const result = yield* selectDigits({ availableDigits, preferredDigits, baseUsername })

        // --- @assert: Returns 00 ---
        expect(result, 'Should return "00" when explicitly requested')
          .toBe<typeof result>(UsernameDigits.make('00'))
      }))
  })

  describe('@EdgeCase', () => {
    it.layer(TestRandomLayer)(it =>
      it.effect('Should_ThrowPreferredDigitsTakenError_When_Preferred00Unavailable', () =>
        Effect.gen(function*() {
          // --- @arrange: User requests 00 but it is already taken ---
          const availableDigits = [UsernameDigits.make('01'), UsernameDigits.make('02')]
          const preferredDigits = UsernameDigits.make('00')
          const baseUsername = 'alice'

          // --- @act: Attempt to select preferred 00 digits ---
          const error = yield* selectDigits({ availableDigits, preferredDigits, baseUsername })
            .pipe(Effect.flip)

          // --- @assert: Throws PreferredDigitsTakenError ---
          expect(error, 'Should throw PreferredDigitsTakenError')
            .toBeInstanceOf(PreferredDigitsTakenError)
        }))
    )
  })
})
