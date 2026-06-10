import { DB, schema } from '#root/db/mod.js'
import { classifySearchPrefix } from '#root/routes/v1/username/username-prefix-match.js'
import { and, asc, eq, gt, or, type SQL, sql } from 'drizzle-orm'
import { Effect, Match } from 'effect'

type Network = 'westend2' | 'paseo' | 'polkadot'
type UsernameStatus = 'ASSIGNED' | 'RESERVED' | 'FAILED'

export interface SearchUsernamesParams {
  readonly network: Network
  readonly prefix: string
  readonly cursor: { readonly username: string; readonly digits: number } | null
  readonly limit: number
}

export interface ListUsernamesParams {
  readonly network: Network
  readonly prefix: string | undefined
  readonly status: UsernameStatus | undefined
  readonly limit: number
}

const buildUsernamePrefixCondition = (prefix: string): SQL => {
  const searchPattern = `${prefix}%`

  const liteCondition =
    sql`(${schema.individualityUsernames.fullUsername} IS NULL AND ${schema.individualityUsernames.username} || '.' || ${schema.individualityUsernames.digits} ILIKE ${searchPattern})`

  const fullCondition =
    sql`(${schema.individualityUsernames.fullUsername} IS NOT NULL AND ${schema.individualityUsernames.fullUsername} ILIKE ${searchPattern})`

  return Match.value(classifySearchPrefix(prefix)).pipe(
    Match.when('LiteOnly', () => liteCondition),
    Match.when('LiteAndFull', () => sql`(${liteCondition} OR ${fullCondition})`),
    Match.exhaustive,
  )
}

export const searchUsernames = Effect.fn('username_prefix_match.store.search')(
  function*({ network, prefix, cursor, limit }: SearchUsernamesParams) {
    const db = yield* DB
    const searchCondition = buildUsernamePrefixCondition(prefix)

    return yield* Effect.tryPromise(() =>
      db
        .select()
        .from(schema.individualityUsernames)
        .where(() => {
          const cursorCondition = cursor
            ? or(
              gt(schema.individualityUsernames.username, cursor.username),
              and(
                eq(schema.individualityUsernames.username, cursor.username),
                gt(sql`${schema.individualityUsernames.digits}::integer`, cursor.digits),
              ),
            )
            : undefined

          return and(eq(schema.individualityUsernames.network, network), searchCondition, cursorCondition)
        })
        .orderBy(
          asc(schema.individualityUsernames.username),
          asc(sql`${schema.individualityUsernames.digits}::integer`),
        )
        .limit(limit + 1)
    )
  },
)

export const listUsernames = Effect.fn('username_prefix_match.store.list')(
  function*({ network, prefix, status, limit }: ListUsernamesParams) {
    const db = yield* DB

    return yield* Effect.tryPromise(() =>
      db
        .select()
        .from(schema.individualityUsernames)
        .where(() => {
          const conditions = [eq(schema.individualityUsernames.network, network)]
          if (prefix) {
            conditions.push(buildUsernamePrefixCondition(prefix))
          }
          if (status) {
            conditions.push(eq(schema.individualityUsernames.status, status))
          }
          return conditions.length > 0 ? and(...conditions) : undefined
        })
        .orderBy(
          asc(schema.individualityUsernames.username),
          asc(schema.individualityUsernames.digits),
        )
        .limit(limit)
    )
  },
)
