import { USERNAME_DIGIT_V1_SET } from '#root/constants.js'
import { UsernameDigits } from '#root/schema/username.js'
import { Effect, Random, Schema as S } from 'effect'

export class PreferredDigitsTakenError extends S.TaggedError<PreferredDigitsTakenError>()(
  'PreferredDigitsTakenError',
  {
    baseUsername: S.String,
    preferredDigits: S.String,
  },
) {}

export class NoDigitsAvailableError extends S.TaggedError<NoDigitsAvailableError>()(
  'NoDigitsAvailableError',
  {
    baseUsername: S.String,
  },
) {}

const selectPreferredDigits = (args: {
  availableDigits: readonly UsernameDigits[]
  preferredDigits: UsernameDigits
  baseUsername: string
}): Effect.Effect<UsernameDigits, PreferredDigitsTakenError> => {
  const { availableDigits, preferredDigits, baseUsername } = args
  if (availableDigits.includes(preferredDigits)) {
    return Effect.succeed(preferredDigits)
  }
  return Effect.fail(new PreferredDigitsTakenError({ baseUsername, preferredDigits }))
}

const selectRandomDigits = (args: {
  availableDigits: readonly UsernameDigits[]
  baseUsername: string
}): Effect.Effect<UsernameDigits, NoDigitsAvailableError, Random.Random> =>
  Effect.gen(function*() {
    const { availableDigits, baseUsername } = args
    const random = yield* Random.Random

    const availableDigitsExcluding00 = availableDigits.filter((d) => d !== '00')
    if (availableDigitsExcluding00.length === 0) {
      return yield* Effect.fail(new NoDigitsAvailableError({ baseUsername }))
    }

    return yield* random.nextIntBetween(0, availableDigitsExcluding00.length).pipe(
      Effect.map((index) => availableDigitsExcluding00[index]!),
    )
  })

export const selectDigits = (args: {
  availableDigits: readonly UsernameDigits[]
  preferredDigits?: UsernameDigits
  baseUsername: string
}): Effect.Effect<UsernameDigits, PreferredDigitsTakenError | NoDigitsAvailableError, Random.Random> => {
  const { availableDigits, preferredDigits, baseUsername } = args
  if (preferredDigits === undefined) {
    return selectRandomDigits({ availableDigits, baseUsername })
  }

  return selectPreferredDigits({ availableDigits, preferredDigits, baseUsername })
}

export const availableDigitsForUsername = (
  allocated: ReadonlyMap<string, ReadonlySet<string>>,
  baseUsername: string,
): ReadonlyArray<UsernameDigits> => {
  const taken = allocated.get(baseUsername) ?? new Set()
  return USERNAME_DIGIT_V1_SET
    .filter((digits) => !taken.has(digits))
    .map((digits) => UsernameDigits.make(digits))
}
