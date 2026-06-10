// Modified from https://github.com/honojs/middleware/blob/main/packages/effect-validator/src/index.ts
// to allow on error handlers
import { Either, ParseResult, Schema as S } from 'effect'
import type { Context, Env, Input, MiddlewareHandler, ValidationTargets } from 'hono'
import type { Simplify } from 'hono/utils/types'
import { validator } from 'hono/validator'

type HasUndefined<T> = undefined extends T ? true : false

export const effectValidator = <
  Target extends keyof ValidationTargets,
  E extends Env,
  P extends string,
  Type,
  Encoded,
  In = Simplify<Encoded>,
  Out = Simplify<Type>,
  I extends Input = {
    in: HasUndefined<In> extends true ? {
        [K in Target]?: K extends 'json' ? In
          : HasUndefined<keyof ValidationTargets[K]> extends true ? { [K2 in keyof In]?: ValidationTargets[K][K2] }
          : { [K2 in keyof In]: ValidationTargets[K][K2] }
      }
      : {
        [K in Target]: K extends 'json' ? In
          : HasUndefined<keyof ValidationTargets[K]> extends true ? { [K2 in keyof In]?: ValidationTargets[K][K2] }
          : { [K2 in keyof In]: ValidationTargets[K][K2] }
      }
    out: Record<Target, Out>
  },
>(
  target: Target,
  schema: S.Schema<Type, Encoded, never>,
  onError?: (error: ParseResult.ParseError, value: unknown, c: Context<E, P>) => void,
): MiddlewareHandler<E, P, I> => {
  // @ts-expect-error not typed well
  return validator(target, async (value, c) => {
    const result = S.decodeUnknownEither(schema)(value)

    return Either.match(result, {
      onLeft: (error) => {
        onError?.(error, value, c)
        return c.json({ success: false, error: ParseResult.ArrayFormatter.formatErrorSync(error) }, 400)
      },
      onRight: (data) => {
        c.req.addValidatedData(target, data as object)
        return data
      },
    })
  })
}
