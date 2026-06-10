import { DB, DBTest } from '#root/db/drizzle.js'
import { BaseUsername, HexString, Network, Ss58String, UsernameDigits } from '#root/schema/mod.js'
import { describe, expect, it, vi } from '@effect/vitest'
import * as schema from '@identity-backend/db/Schema'
import { Arbitrary, Array, Effect, HashMap, HashSet, Layer, pipe, Schema as S } from 'effect'
import * as fc from 'fast-check'
import { afterEach } from 'node:test'
import { IndividualityUsernameService, IndividualityUsernameServiceConfig } from '../username-availability.service.js'

describe('UsernameService', () => {
  const getNetwork = vi.fn<IndividualityUsernameServiceConfig['Type']['getNetwork']>()

  const layers = Layer.provideMerge(
    IndividualityUsernameService.DefaultWithoutDependencies,
    Layer.mergeAll(
      Layer.succeed(IndividualityUsernameServiceConfig, { getNetwork }),
      DBTest,
    ),
  )

  afterEach(() => {
    getNetwork.mockReset()
  })

  it.layer(layers)((it) => {
    it.effect.prop(
      '∀x_ReturnCorrectAvailability_=x',
      [
        S.HashMap({
          key: BaseUsername,
          value: S.HashMap({ key: UsernameDigits, value: S.Tuple(Network) }).pipe(
            S.filter((hm) => HashMap.size(hm) % 10 === 0 && HashMap.size(hm) <= 100),
          ),
        }).pipe(
          S.filter((hm) => HashMap.size(hm) % 10 === 0 && HashMap.size(hm) <= 100),
        ),
        Network,
      ],
      ([usernamesMap, network]) =>
        Effect.gen(function*() {
          const db = yield* DB
          const usernameService = yield* IndividualityUsernameService

          yield* Effect.sync(() => {
            getNetwork.mockImplementation(() => Effect.succeed(network))
          })

          yield* Effect.tryPromise(() => db.delete(schema.individualityUsernames).execute())
            .pipe(Effect.orDie)

          const usernamesToInsert = pipe(
            Array.fromIterable(HashMap.entries(usernamesMap)),
            Array.map(([username, hm]) =>
              pipe(
                Array.fromIterable(HashMap.entries(hm)),
                Array.map(([digits, [network]]) => ({
                  username,
                  reservedUsername: null,
                  digits,
                  network,
                  candidateAccountId: fc.sample(Arbitrary.make(Ss58String))[0]!,
                  candidateSignature: fc.sample(Arbitrary.make(HexString))[0]!,
                  consumerRegistrationSignature: fc.sample(Arbitrary.make(HexString))[0]!,
                  ringVrfKey: fc.sample(Arbitrary.make(HexString))[0]!,
                  proofOfOwnership: fc.sample(Arbitrary.make(HexString))[0]!,
                  identifierKey: fc.sample(Arbitrary.make(HexString))[0]!,
                  status: fc.sample(fc.constantFrom<'RESERVED' | 'ASSIGNED'>('RESERVED', 'ASSIGNED'))[0]!,
                })),
              )
            ),
            Array.flatten,
          )

          if (usernamesToInsert.length > 0) {
            yield* Effect.tryPromise(() =>
              db.insert(schema.individualityUsernames)
                .values(usernamesToInsert)
                .execute()
            ).pipe(Effect.orDie)
          }

          const usernames = Array.fromIterable(HashMap.keys(usernamesMap))
          const result = yield* usernameService.checkAvailability({
            usernames: usernames.length > 0 ? HashSet.make(...usernames) : HashSet.empty(),
          })

          const expectedResult = pipe(
            usernamesMap,
            HashMap.map(digitToNetworkMap => {
              const matchingDigits = pipe(
                digitToNetworkMap,
                HashMap.entries,
                Array.fromIterable,
                Array.filter(([_digits, networks]) => Array.some(networks, n => n === network)),
                Array.map(([digits]) => digits),
                Array.filter((digits) => digits.length <= 2),
                HashSet.fromIterable,
              )
              return matchingDigits
            }),
          )

          const resultPlain = pipe(
            result,
            HashMap.entries,
            Array.fromIterable,
            Array.map(([username, digits]) => [username, Array.fromIterable(digits)]),
          )

          const expectedPlain = pipe(
            expectedResult,
            HashMap.entries,
            Array.fromIterable,
            Array.map(([username, digits]) => [username, Array.fromIterable(digits)]),
          )

          expect(resultPlain).toEqual(expectedPlain)
        }),
      { fastCheck: { numRuns: 12 } },
    )
  })
})
