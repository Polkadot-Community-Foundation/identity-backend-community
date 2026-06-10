import { CursorPaginationService } from '#root/lib/cursor-pagination/cursor-pagination.service.js'
import { Context, Effect, Either, Exit, Layer, Match, pipe, Runtime, Schema as S } from 'effect'

export class CursorPaginationMiddlewareConfig extends Context.Tag(
  'identity-backend-container/plugins/cursor-pagination.middleware/CursorPaginationMiddlewareConfig',
)<CursorPaginationMiddlewareConfig, {
  sign: CursorPaginationService['sign']
  verify: CursorPaginationService['verify']
}>() {}

export const cursorPaginationMiddlewareFactoryWithoutDependencies = <Type, Encoded>(
  schema: S.Schema<Type, Encoded>,
) =>
  Effect.gen(function*() {
    const { createMiddleware } = yield* Effect.promise(() => import('hono/factory'))
    const service = yield* CursorPaginationMiddlewareConfig
    const runtime = yield* Effect.runtime()

    return createMiddleware<{ Variables: { validatedCursor?: Type } }>(
      async (c, next) => {
        const cursor = c.req.query('cursor')

        if (!cursor) {
          return await next()
        }

        const exit = await pipe(
          service.verify(cursor, schema),
          Effect.either,
          Effect.exit,
          Runtime.runPromise(runtime),
        )

        if (Exit.isFailure(exit)) {
          throw exit.cause
        }

        const result = exit.value

        if (Either.isLeft(result)) {
          return Match.value(result.left).pipe(
            Match.tag('CursorDecodeError', () => c.json({ error: 'Invalid cursor' }, 400)),
            Match.exhaustive,
          )
        }

        c.set('validatedCursor', result.right)

        return await next()
      },
    )
  })

export const cursorPaginationMiddlewareFactory = <Type, Encoded>(schema: S.Schema<Type, Encoded>) =>
  cursorPaginationMiddlewareFactoryWithoutDependencies(schema).pipe(
    Effect.provide(
      Layer.effect(
        CursorPaginationMiddlewareConfig,
        Effect.gen(function*() {
          const cursorPaginationService = yield* CursorPaginationService

          return {
            sign: cursorPaginationService.sign,
            verify: cursorPaginationService.verify,
          } satisfies CursorPaginationMiddlewareConfig['Type'] as CursorPaginationMiddlewareConfig['Type']
        }),
      ),
    ),
  )
