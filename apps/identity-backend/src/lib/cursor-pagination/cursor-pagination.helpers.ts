import { Clock, Effect, Schema as S } from 'effect'
import { CursorPaginationService } from './cursor-pagination.service.js'

export const paginateResults = (limit: number) => <T>(items: T[]) => {
  const hasMore = items.length > limit
  const pageItems = hasMore ? items.slice(0, limit) : items
  return { hasMore, pageItems }
}

export const generateNextCursor = <T, CursorShape extends { timestamp: Date }, Encoded>(
  hasMore: boolean,
  pageItems: T[],
  schema: S.Schema<CursorShape, Encoded, never>,
  extractCursorData: (item: T) => Omit<CursorShape, 'timestamp'>,
) =>
  Effect.gen(function*() {
    const cursorService = yield* CursorPaginationService

    if (!hasMore || pageItems.length === 0) return null

    const lastItem = pageItems[pageItems.length - 1]!
    const currentTime = new Date(yield* Clock.currentTimeMillis)
    const cursorData = { ...extractCursorData(lastItem), timestamp: currentTime } as CursorShape

    return yield* cursorService.sign(cursorData, schema)
  })

export const paginateWithCursor = <T, CursorShape extends { timestamp: Date }, Encoded>(options: {
  items: T[]
  limit: number
  schema: S.Schema<CursorShape, Encoded, never>
  extractCursor: (item: T) => Omit<CursorShape, 'timestamp'>
}) =>
  Effect.gen(function*() {
    const { hasMore, pageItems } = paginateResults(options.limit)(options.items)
    const nextCursor = yield* generateNextCursor(hasMore, pageItems, options.schema, options.extractCursor)

    return { pageItems, nextCursor }
  })
