import { BaseUsername, UsernameDigits } from '#root/schema/mod.js'
import { DB } from '@identity-backend/db'
import { Array, Context, Effect, HashMap, HashSet, Layer, Option, Schema as S } from 'effect'

export class UsernameServiceError
  extends S.TaggedError<UsernameServiceError>('UsernameServiceError')('UsernameServiceError', {
    cause: S.optionalWith(S.Unknown, { nullable: true }),
  })
{}

export namespace IndividualityUsernameService {
  export interface CheckAvailabilityParams {
    usernames: HashSet.HashSet<BaseUsername>
  }

  export interface UsernameService {
    checkAvailability: (
      params: CheckAvailabilityParams,
    ) => Effect.Effect<HashMap.HashMap<BaseUsername, HashSet.HashSet<UsernameDigits>>, UsernameServiceError>
  }
}

export class IndividualityUsernameServiceConfig
  extends Context.Tag('IndividualityUsernameServiceConfig')<IndividualityUsernameServiceConfig, {
    getNetwork: () => Effect.Effect<'westend2' | 'paseo' | 'polkadot'>
  }>()
{}

export class IndividualityUsernameService
  extends Effect.Service<IndividualityUsernameService>()('IndividualityUsernameService', {
    effect: Effect.gen(function*() {
      const schema = yield* Effect.promise(() => import('@identity-backend/db/Schema'))
      const { and, eq, inArray } = yield* Effect.promise(() => import('drizzle-orm'))
      const db = yield* DB
      const config = yield* IndividualityUsernameServiceConfig

      const checkAvailability = Effect.fn('username_checkAvailability')(function*(params) {
        const network = yield* config.getNetwork()
        const usernames = [...HashSet.values(params.usernames)]

        if (usernames.length === 0) {
          return HashMap.empty()
        }

        const selectUsernamesResult = yield* Effect.tryPromise({
          try: () =>
            db.select({
              username: schema.individualityUsernames.username,
              digits: schema.individualityUsernames.digits,
            })
              .from(schema.individualityUsernames)
              .where(and(
                inArray(schema.individualityUsernames.username, usernames),
                eq(schema.individualityUsernames.network, network),
              )),
          catch: (cause) => UsernameServiceError.make({ cause }),
        }).pipe(
          Effect.map(Array.map(({ username, digits }) => ({
            username: BaseUsername.make(username),
            digits: digits !== null ? UsernameDigits.make(digits) : null,
          }))),
          Effect.map(Array.filter((row) => row.digits === null || row.digits.length <= 2)),
        )

        const usernameDigitsMap = Array.reduce(
          selectUsernamesResult,
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

        const finalMap = HashMap.fromIterable(
          Array.map(usernames, (username) => {
            const digitsOpt = HashMap.get(usernameDigitsMap, username)
            const digits = Option.getOrElse(digitsOpt, () => HashSet.empty<UsernameDigits>())
            return [username, digits] as const
          }),
        )

        return finalMap
      }) satisfies IndividualityUsernameService.UsernameService['checkAvailability']

      return {
        checkAvailability,
      } satisfies IndividualityUsernameService.UsernameService
    }),
    dependencies: [
      Layer.effect(
        IndividualityUsernameServiceConfig,
        Effect.gen(function*() {
          const { PEOPLE_NETWORK } = yield* Effect.promise(() => import('#root/config.js'))
          const network = yield* PEOPLE_NETWORK

          return {
            getNetwork: () => Effect.succeed(network),
          } satisfies IndividualityUsernameServiceConfig['Type'] as IndividualityUsernameServiceConfig['Type']
        }),
      ),
    ],
  })
{}
