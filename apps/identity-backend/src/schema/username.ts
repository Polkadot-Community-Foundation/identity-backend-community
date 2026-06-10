import { Array, Either, ParseResult, Schema as S } from 'effect'

/**
 * The base username.  For example `myusername.23`, `myusername` is the base username.
 */
export const BaseUsername = S.String.pipe(S.pattern(/^([a-z]{6,})$/), S.brand('BaseUsername'))

export type BaseUsername = S.Schema.Type<typeof BaseUsername>

/**
 * The digits that will be suffixed to the username. For example `myusername.23`, `23` are the
 * two digits.
 */
export const UsernameDigits = S.String.pipe(S.pattern(/^[0-9]{1,10}$/), S.brand('UsernameDigits'))

export type UsernameDigits = S.Schema.Type<typeof UsernameDigits>

/**
 * Lite username format: `{base}.{digits}` (e.g., "alice.42", "bob.99")
 */
export const LiteUsername = S.transformOrFail(
  S.String,
  S.Struct({
    username: BaseUsername,
    digits: UsernameDigits,
  }),
  {
    strict: true,
    decode: (liteUsername, options, ast) => {
      const parts = liteUsername.split('.')

      if (parts.length !== 2) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            liteUsername,
            `Invalid lite username format: "${liteUsername}". Expected format: {letters}.{digits}`,
          ),
        )
      }

      const [base, suffix] = parts
      const errors: ParseResult.ParseIssue[] = []

      const usernameResult = ParseResult.decodeUnknownEither(BaseUsername)(base, options)
      if (Either.isLeft(usernameResult)) {
        errors.push(
          new ParseResult.Pointer(
            'username',
            liteUsername,
            usernameResult.left,
          ),
        )
      }

      const digitsResult = ParseResult.decodeUnknownEither(UsernameDigits)(suffix, options)
      if (Either.isLeft(digitsResult)) {
        errors.push(
          new ParseResult.Pointer(
            'digits',
            liteUsername,
            digitsResult.left,
          ),
        )
      }

      if (Array.isNonEmptyArray(errors)) {
        return ParseResult.fail(
          new ParseResult.Composite(
            ast,
            liteUsername,
            errors,
          ),
        )
      }

      const username = Either.getOrThrow(usernameResult)
      const digits = Either.getOrThrow(digitsResult)

      return ParseResult.succeed({
        username,
        digits,
      })
    },
    encode: ({ username, digits }) => ParseResult.succeed(`${username}.${digits}`),
  },
)

export type LiteUsername = S.Schema.Type<typeof LiteUsername>
