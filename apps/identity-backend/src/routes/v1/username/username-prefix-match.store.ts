import { N_USERNAME_DIGITS } from '#root/constants.js'
import { DB, schema } from '#root/db/mod.js'
import { classifySearchPrefix } from '#root/routes/v1/username/username-prefix-match.js'
import { BaseUsername, UsernameDigits } from '#root/schema/mod.js'
import { and, asc, eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm'
import { Array, Effect, HashMap, HashSet, Match, Option, Schema as S } from 'effect'

type Network = 'westend2' | 'paseo' | 'polkadot'
type UsernameStatus = 'ASSIGNED' | 'RESERVED' | 'FAILED'

export interface SearchCursor {
  readonly key: string
  readonly username: string
  readonly digits: number
}

export interface SearchUsernamesParams {
  readonly network: Network
  readonly prefix: string
  readonly cursor: SearchCursor | null
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

const searchDisplayKey: SQL =
  sql`(lower(coalesce(${schema.individualityUsernames.fullUsername}, ${schema.individualityUsernames.username} || '.' || ${schema.individualityUsernames.digits}))) COLLATE "C"`

/**
 * Only lite usernames (`fullUsername IS NULL`) whose digit suffix fits the V1
 * length bound are filtered. Full usernames from chain have no digit suffix —
 * the `digits` column is a NOT-NULL placeholder for them — so they always pass.
 * Lite rows with 3+ digit suffixes cannot be registered via V1
 * (`USERNAME_DIGITS_V1_REGEXP` allows only 01–99) and are excluded here.
 */
export const v1DigitsLengthBound: SQL =
  sql`(${schema.individualityUsernames.fullUsername} IS NOT NULL OR length(${schema.individualityUsernames.digits}) <= ${N_USERNAME_DIGITS})`

const nextPrefixBound = (lowered: string): string =>
  lowered.slice(0, -1) + String.fromCharCode(lowered.charCodeAt(lowered.length - 1) + 1)

export const searchUsernames = Effect.fn('username_prefix_match.store.search')(
  function*({ network, prefix, cursor, limit }: SearchUsernamesParams) {
    const db = yield* DB
    const lowerBound = prefix.toLowerCase()
    const upperBound = nextPrefixBound(lowerBound)

    const liteOnly = classifySearchPrefix(prefix) === 'LiteOnly'
      ? sql`${schema.individualityUsernames.fullUsername} IS NULL`
      : undefined

    const afterCursor = cursor
      ? sql`(${searchDisplayKey} > ${cursor.key} OR (${searchDisplayKey} = ${cursor.key} AND (${schema.individualityUsernames.username} > ${cursor.username} OR (${schema.individualityUsernames.username} = ${cursor.username} AND ${schema.individualityUsernames.digits}::integer > ${cursor.digits}))))`
      : undefined

    return yield* Effect.tryPromise(() =>
      db
        .select({
          ...getTableColumns(schema.individualityUsernames),
          searchKey: sql<string>`${searchDisplayKey}`.as('search_key'),
        })
        .from(schema.individualityUsernames)
        .where(and(
          eq(schema.individualityUsernames.network, network),
          sql`${searchDisplayKey} >= ${lowerBound}`,
          sql`${searchDisplayKey} < ${upperBound}`,
          v1DigitsLengthBound,
          liteOnly,
          afterCursor,
        ))
        .orderBy(
          searchDisplayKey,
          asc(schema.individualityUsernames.username),
          sql`${schema.individualityUsernames.digits}::integer`,
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
          const conditions: SQL[] = [
            eq(schema.individualityUsernames.network, network),
            v1DigitsLengthBound,
          ]
          if (prefix) {
            conditions.push(buildUsernamePrefixCondition(prefix))
          }
          if (status) {
            conditions.push(eq(schema.individualityUsernames.status, status))
          }
          return and(...conditions)
        })
        .orderBy(
          asc(schema.individualityUsernames.username),
          asc(schema.individualityUsernames.digits),
        )
        .limit(limit)
    )
  },
)

export class UsernameServiceError
  extends S.TaggedError<UsernameServiceError>('UsernameServiceError')('UsernameServiceError', {
    cause: S.optionalWith(S.Unknown, { nullable: true }),
  })
{}

export interface CheckUsernameAvailabilityParams {
  readonly network: Network
  readonly usernames: HashSet.HashSet<BaseUsername>
}

export const checkUsernameAvailability = Effect.fn('username_prefix_match.store.checkAvailability')(
  function*({ network, usernames }: CheckUsernameAvailabilityParams) {
    const db = yield* DB
    const usernameArray = Array.fromIterable(usernames)

    if (usernameArray.length === 0) {
      return HashMap.empty<BaseUsername, HashSet.HashSet<UsernameDigits>>()
    }

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            username: schema.individualityUsernames.username,
            digits: schema.individualityUsernames.digits,
          })
          .from(schema.individualityUsernames)
          .where(and(
            inArray(schema.individualityUsernames.username, usernameArray),
            eq(schema.individualityUsernames.network, network),
            v1DigitsLengthBound,
          )),
      catch: (cause) => UsernameServiceError.make({ cause }),
    })

    const brandedRows = Array.map(rows, ({ username, digits }) => ({
      username: BaseUsername.make(username),
      digits: digits !== null ? UsernameDigits.make(digits) : null,
    }))

    const usernameDigitsMap = Array.reduce(
      brandedRows,
      HashMap.empty<BaseUsername, HashSet.HashSet<UsernameDigits>>(),
      (acc, { username, digits }) => {
        if (!digits) {
          return HashMap.has(acc, username)
            ? acc
            : HashMap.set(acc, username, HashSet.empty<UsernameDigits>())
        }
        const existing = HashMap.get(acc, username)
        const set = Option.getOrElse(existing, () => HashSet.empty<UsernameDigits>())
        return HashMap.set(acc, username, HashSet.add(set, digits))
      },
    )

    return HashMap.fromIterable(
      Array.map(usernameArray, (username) => {
        const digitsOpt = HashMap.get(usernameDigitsMap, username)
        const digits = Option.getOrElse(digitsOpt, () => HashSet.empty<UsernameDigits>())
        return [username, digits] as const
      }),
    )
  },
)
