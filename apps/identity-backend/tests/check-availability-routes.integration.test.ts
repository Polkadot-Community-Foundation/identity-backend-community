import { DB, DBTest } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { IndividualityUsernameService } from '#root/features/individuality/services/username-availability.service.js'
import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { layerCheckAvailabilityRoutes } from '#root/routes/v1/username/check-availability/layer.js'
import { makeCheckAvailabilityRouteWithoutDependencies } from '#root/routes/v1/username/check-availability/routes.js'
import { it } from '@effect/vitest'
import { checkResponse } from '@identity-backend/testing/hono'
import { ConfigProvider, Effect, Layer, pipe } from 'effect'
import { HTTPException } from 'hono/http-exception'
import { testClient } from 'hono/testing'
import { describe, expect } from 'vitest'
import { generateUsernameDataArray } from './helpers/test-data.js'

describe('CheckAvailability Integration', () => {
  const NETWORK = 'westend2' as const

  const layer = pipe(
    layerCheckAvailabilityRoutes,
    Layer.provideMerge(IndividualityUsernameService.Default),
    Layer.provideMerge(DBTest),
    Layer.provideMerge(Layer.setConfigProvider(ConfigProvider.fromJson({ PEOPLE_NETWORK: NETWORK }))),
  )

  const makeClient = pipe(
    makeCheckAvailabilityRouteWithoutDependencies(),
    Effect.map((routes) => {
      const app = createOpenAPIHono()
        .route('/', routes)
        .onError((err, c) => {
          if (err instanceof HTTPException) return err.getResponse()
          return c.json({ error: 'Internal Server Error' }, 500)
        })
      return testClient(app)
    }),
  )

  const parseJsonBody = <T>(res: Response) => Effect.promise(() => res.json() as Promise<T>)

  const cleanUp = Effect.andThen(DB, (db) => db.delete(schema.individualityUsernames).execute()).pipe(Effect.orDie)

  interface V1Body {
    _tag: string
    value: Record<string, { status: string; availableDigits?: number[] }>
  }

  const seedDigits = (db: DB['Type'], params: { username: string; digits: string[] }) => {
    const records = params.digits.map((digit, i) =>
      generateUsernameDataArray(1, { username: params.username, digits: digit, network: NETWORK }, i)[0]!
    )
    return Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))
  }

  const seedAllDigits = (db: DB['Type'], username: string) => {
    const records = globalThis.Array.from({ length: 100 }, (_: unknown, i: number) =>
      generateUsernameDataArray(1, {
        username,
        digits: String(i).padStart(2, '0'),
        network: NETWORK,
      }, 0)[0]!)
    return Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))
  }

  it.layer(layer)((it) => {
    it.scoped('Should_ReturnAvailable_When_UsernameHasNoRecordsInDatabase', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const client = yield* makeClient

        const res = yield* Effect.promise(() =>
          client.index.$post({
            json: { usernames: ['aliceee'] },
            query: { version: 'v1' },
          })
        )

        checkResponse(res, 200)
        const body = yield* parseJsonBody<V1Body>(res)

        expect.soft(body._tag, 'response should be v1 envelope').toBe('v1')
        expect.soft(body.value['aliceee'], 'aliceee should be available with all 99 digits').toMatchObject({
          status: 'AVAILABLE',
          availableDigits: expect.any(globalThis.Array),
        })
        expect.soft(body.value['aliceee']!.availableDigits, 'all 99 digits available when no allocations').toHaveLength(
          99,
        )
      }))

    it.scoped('Should_ReturnAvailableWithCorrectDigits_When_PartiallyAllocatedInDatabase', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const db = yield* DB
        yield* seedDigits(db, { username: 'aliceee', digits: ['01', '02', '50'] })
        const client = yield* makeClient

        const res = yield* Effect.promise(() =>
          client.index.$post({
            json: { usernames: ['aliceee'] },
            query: { version: 'v1' },
          })
        )

        checkResponse(res, 200)
        const body = yield* parseJsonBody<V1Body>(res)

        const entry = body.value['aliceee']!
        expect.soft(entry, 'aliceee should be available with partial digits').toMatchObject({
          status: 'AVAILABLE',
          availableDigits: expect.arrayContaining([3, 99]),
        })
        expect.soft(entry.availableDigits, 'allocated digits excluded').toEqual(
          expect.not.arrayContaining([1, 2, 50]),
        )
        expect.soft(entry.availableDigits, '99 - 3 allocated = 96 available').toHaveLength(96)
      }))

    it.scoped('Should_ReturnExhausted_When_AllDigitsAllocatedInDatabase', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const db = yield* DB
        yield* seedAllDigits(db, 'fulluser')

        const client = yield* makeClient

        const res = yield* Effect.promise(() =>
          client.index.$post({
            json: { usernames: ['fulluser'] },
            query: { version: 'v0' },
          })
        )

        checkResponse(res, 200)
        const body = yield* parseJsonBody<Record<string, string>>(res)
        expect.soft(body['fulluser'], 'fulluser should be exhausted with 100 digits allocated').toBe('EXHAUSTED')
      }))

    it.scoped('Should_ReturnInvalid_When_UsernameFailsBaseUsernameValidation', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        const res = yield* Effect.promise(() =>
          client.index.$post({
            json: { usernames: ['x', '123', 'UPPER', 'ab.cd'] },
            query: { version: 'v0' },
          })
        )

        checkResponse(res, 200)
        const body = yield* parseJsonBody<Record<string, string>>(res)

        expect.soft(body['x'], 'single char too short').toBe('INVALID')
        expect.soft(body['123'], 'numeric string').toBe('INVALID')
        expect.soft(body['UPPER'], 'uppercase letters').toBe('INVALID')
        expect.soft(body['ab.cd'], 'contains dot separator').toBe('INVALID')
      }))

    it.scoped('Should_IgnoreRecordsFromDifferentNetwork_When_CheckingAvailability', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const db = yield* DB
        const records = globalThis.Array.from({ length: 100 }, (_: unknown, i: number) =>
          generateUsernameDataArray(1, {
            username: 'aliceee',
            digits: String(i).padStart(2, '0'),
            network: 'polkadot',
          }, 300 + i)[0]!)
        yield* Effect.tryPromise(() => db.insert(schema.individualityUsernames).values(records))

        const client = yield* makeClient

        const res = yield* Effect.promise(() =>
          client.index.$post({
            json: { usernames: ['aliceee'] },
            query: { version: 'v0' },
          })
        )

        checkResponse(res, 200)
        const body = yield* parseJsonBody<Record<string, string>>(res)
        expect.soft(body['aliceee'], 'polkadot records should not affect westend2 query').toBe('AVAILABLE')
      }))

    it.scoped('Should_ReturnMixedV0Statuses_When_MultipleUsernamesWithDifferentStates', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const db = yield* DB
        yield* seedAllDigits(db, 'aliceee')
        yield* seedDigits(db, { username: 'bobbobo', digits: ['01', '02'] })

        const client = yield* makeClient

        const res = yield* Effect.promise(() =>
          client.index.$post({
            json: { usernames: ['aliceee', 'bobbobo', 'charlie', 'bad!'] },
            query: { version: 'v0' },
          })
        )

        checkResponse(res, 200)
        const body = yield* parseJsonBody<Record<string, string>>(res)

        expect.soft(body, 'mixed statuses in single v0 response').toEqual({
          aliceee: 'EXHAUSTED',
          bobbobo: 'AVAILABLE',
          charlie: 'AVAILABLE',
          'bad!': 'INVALID',
        })
      }))

    it.scoped('Should_ReturnMixedV1Statuses_When_MultipleUsernamesWithDifferentStates', () =>
      Effect.gen(function*() {
        yield* Effect.addFinalizer(() => cleanUp)

        const db = yield* DB
        yield* seedAllDigits(db, 'aliceee')
        yield* seedDigits(db, { username: 'bobbobo', digits: ['01', '50'] })

        const client = yield* makeClient

        const res = yield* Effect.promise(() =>
          client.index.$post({
            json: { usernames: ['aliceee', 'bobbobo', 'charlie', 'bad!'] },
            query: { version: 'v1' },
          })
        )

        checkResponse(res, 200)
        const body = yield* parseJsonBody<V1Body>(res)

        expect.soft(body._tag, 'v1 envelope tag').toBe('v1')

        expect.soft(body.value['aliceee'], 'aliceee exhausted').toMatchObject({ status: 'EXHAUSTED' })
        expect.soft(body.value['bad!'], 'bad! invalid').toMatchObject({ status: 'INVALID' })

        expect.soft(body.value['charlie'], 'charlie available with full digits').toMatchObject({
          status: 'AVAILABLE',
          availableDigits: expect.any(globalThis.Array),
        })
        expect.soft(body.value['charlie']!.availableDigits, 'charlie has all 99 digits').toHaveLength(99)

        const bobEntry = body.value['bobbobo']!
        expect.soft(bobEntry, 'bobbobo available with partial digits').toMatchObject({
          status: 'AVAILABLE',
          availableDigits: expect.arrayContaining([2, 3, 99]),
        })
        expect.soft(bobEntry.availableDigits, 'bobbobo excludes allocated digits').toEqual(
          expect.not.arrayContaining([1, 50]),
        )
        expect.soft(bobEntry.availableDigits, '99 - 2 allocated = 97 available').toHaveLength(97)
      }))

    it.scoped('Should_ReturnEmptyResponse_When_EmptyUsernameArray', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        const res = yield* Effect.promise(() =>
          client.index.$post({
            json: { usernames: [] },
            query: { version: 'v0' },
          })
        )

        checkResponse(res, 200)
        const body = yield* parseJsonBody<Record<string, string>>(res)
        expect.soft(body, 'empty input produces empty output').toEqual({})
      }))

    it.scoped('Should_Return400WithProblemDetails_When_QueryVersionInvalid', () =>
      Effect.gen(function*() {
        const client = yield* makeClient

        // Bypass typed client to send invalid query param
        const res = yield* Effect.promise(() =>
          client.index.$post({
            json: { usernames: ['alice'] },
            query: { version: 'invalid-version' as 'v0' },
          })
        )

        expect(res.status).toBe(400)
        expect(res.headers.get('content-type')).toBe('application/problem+json')
      }))

    it.scoped.each([
      {
        username: 'onlyover',
        expected: 'AVAILABLE',
        seed: Effect.gen(function*() {
          const db = yield* DB
          yield* seedDigits(db, { username: 'onlyover', digits: ['123', '4567', '89101'] })
        }),
      },
      {
        username: 'mixedusr',
        expected: 'AVAILABLE',
        seed: Effect.gen(function*() {
          const db = yield* DB
          yield* seedDigits(db, { username: 'mixedusr', digits: ['01', '02', '123', '4567'] })
        }),
      },
      {
        username: 'fullex',
        expected: 'EXHAUSTED',
        seed: Effect.gen(function*() {
          const db = yield* DB
          yield* seedAllDigits(db, 'fullex')
          yield* seedDigits(db, { username: 'fullex', digits: ['123', '4567'] })
        }),
      },
      {
        username: 'overfloww',
        expected: 'AVAILABLE',
        seed: Effect.gen(function*() {
          const db = yield* DB
          const overlong = Array.from({ length: 101 }, (_, i) => String(i + 100))
          yield* seedDigits(db, { username: 'overfloww', digits: overlong })
        }),
      },
    ])(
      'Should_Return$expected_When_$username',
      ({ username, expected, seed }) =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => cleanUp)
          yield* seed
          const client = yield* makeClient
          const res = yield* Effect.promise(() =>
            client.index.$post({
              json: { usernames: [username] },
              query: { version: 'v0' },
            })
          )
          checkResponse(res, 200)
          const body = yield* parseJsonBody<Record<string, string>>(res)
          expect(body).toStrictEqual({ [username]: expected })
        }),
    )
  })
})
